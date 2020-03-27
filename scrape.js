const aws = require('aws-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment');

const documentClient = new aws.DynamoDB.DocumentClient();
const sns = new aws.SNS();

const ENUMS = {
  DATE: 'MMMM DD, YYYY',
};

const dateSelected = process.env.DATE_SELECTED || moment().format(ENUMS.DATE);
let dateTracker = dateSelected;
let dateInString = moment(dateSelected).format(ENUMS.DATE);
let continueAddingText = true;
const finalMessage = {};
const regexForDate = /(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|Jun(e)?|Jul(y)?|Aug(ust)?|Sep(tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\s+\d{1,2},\s+\d{4}/;

const buildMessage = (arr) => {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].data) {
      if (
        arr[i].data.match(regexForDate)
        && arr[i].data.match(regexForDate)[0] != undefined
        && Date.parse(arr[i].data.match(regexForDate)[0])
        && Date.parse(arr[i].data.match(regexForDate)[0]) > Date.parse(dateInString)
      ) {
        console.log('Date greater', arr[i].data.match(regexForDate)[0]);
        dateTracker = arr[i].data.match(regexForDate)[0];
        continue;
      } else if (
        arr[i].data.match(regexForDate)
        && arr[i].data.match(regexForDate)[0] != undefined
        && Date.parse(arr[i].data.match(regexForDate)[0])
        && Date.parse(arr[i].data.match(regexForDate)[0]) === Date.parse(dateInString)
      ) {
        console.log('Equal date', arr[i].data.match(regexForDate)[0]);
        dateTracker = arr[i].data.match(regexForDate)[0];
        continue;
      } else if (
        arr[i].data.match(regexForDate)
        && arr[i].data.match(regexForDate)[0] != undefined
        && Date.parse(arr[i].data.match(regexForDate)[0])
        && Date.parse(arr[i].data.match(regexForDate)[0]) < Date.parse(dateInString)
      ) {
        console.log('Lower date', arr[i].data.match(regexForDate)[0]);
        dateTracker = arr[i].data.match(regexForDate)[0];
        continueAddingText = false;
        return;
      }
      console.log('Date trakcer', dateTracker);
      console.log(finalMessage[`${Date.parse(dateTracker)}`])
      console.log('Final text', JSON.stringify(finalMessage));
      continueAddingText
        ? (
            finalMessage[`${Date.parse(dateTracker)}`]
              ? finalMessage[`${Date.parse(dateTracker)}`].text += arr[i].data
              : finalMessage[`${Date.parse(dateTracker)}`] = {
                  text: arr[i].data,
                }
          )
        : i = arr.length;
      continue;
    }

    if (arr[i].name === 'a') {
      const keys = Object.keys(finalMessage[Date.parse(dateTracker)]).filter(x => x.includes('link'));
      finalMessage[Date.parse(dateTracker)][`link${keys.length + 1}`] =
        process.env.WEBSITE //'https://www.canada.ca/en/revenue-agency/campaigns/covid-19-update.html'
        + arr[i].attribs.href;
    }

    if (arr[i].children) {
      buildMessage(arr[i].children);
    }
  }
  return finalMessage;
};

const buildParams = (message) => {
  const arr = [];

  for (let key in message) {
    arr.push({
     date: key,
    });
  }

  return arr;
};

const batchItems = (items, batchSize) => {
  const putRequestBatches = [];
  for (let i = 0; i < items.length; i++) {
    // Making a new batch every 25 items
    if (i % batchSize === 0) {
      putRequestBatches.push([]);
    }

    const batchIndex = Math.floor(i / batchSize);
    putRequestBatches[batchIndex].push(items[i]);
  }

  return putRequestBatches;
};

const params = (arr) => ({
  RequestItems: {
    [process.env.TABLE_NAME]: {
      Keys: arr,
    },
  }
});

const buildTextMessage = (arr, message) => {
  let finalTextMessage = '';

  for (let key of arr) {
    finalTextMessage += '\n' + `${moment(Number(key)).format(ENUMS.DATE)}: ${message[key].text}`;
    const linkKeys = Object.keys(message[key]).filter(x => x.includes('link'));

    finalTextMessage += '\n';
    
    for (let linkKey of linkKeys) {
      finalTextMessage += '\n' + `${linkKey}: ${message[key][linkKey]}`;
    }
    finalTextMessage += '\n';
  }
  console.log('message before trim', finalTextMessage);
  finalTextMessage = finalTextMessage.trim();
  return finalTextMessage;
};

exports.handler = async (event) => {
  let datesToSendAndSave = [];
  try {
    console.log('Invoked with event', event);
    const result = await axios.get(
      process.env.WEBSITE, //'https://www.canada.ca/en/revenue-agency/campaigns/covid-19-update.html'
    );
    const $ = cheerio.load(result.data);
    const loopSite = $('.mwspanel .section').map((index, element) => {
      try {
        buildMessage(element.children);
        for (let key in finalMessage) {
          finalMessage[key].text =
            finalMessage[key].text.replace(/^\s+|\s+$/g, '');
        }
      } catch (err) {
        console.log('Error each', err);
      }
    }).get();
    console.log('Finale message after all the looping', finalMessage);
  } catch (err) {
    console.log('err', err);
    throw err;
  }

  try {
    // Check against DynamoDB Table
    const fullArrayOfKeys = buildParams(finalMessage);
    const batchArrayOfKeys = batchItems(fullArrayOfKeys, 25);
    const batchGetItemsFromDynamoWithEpoch = await Promise.all(batchArrayOfKeys.map(async (keys) => {
      try {
        const resultFromBatchGet = await documentClient.batchGet(params(keys)).promise();
        console.log('result from batch get', JSON.stringify(resultFromBatchGet));
        return resultFromBatchGet.Responses[process.env.TABLE_NAME];
      } catch (err) {
        console.log('Error batch getting items', err);
        throw err;
      }
    }));

    console.log('after batch getting items', batchGetItemsFromDynamoWithEpoch);
    let matchedKeys = [];
    if (batchGetItemsFromDynamoWithEpoch.length > 0) {
      batchGetItemsFromDynamoWithEpoch.forEach((arr) => {
        const getJustDates = arr.map(y => y.date);
        matchedKeys.push(...getJustDates);
      });
    }

    console.log('matched keys', matchedKeys);
    const getJustDatesForArrayOfKeys = fullArrayOfKeys.map(z => z.date);
    console.log('just dates', getJustDatesForArrayOfKeys);
    datesToSendAndSave = getJustDatesForArrayOfKeys.filter(x => !matchedKeys.includes(x));
    console.log('checking the difference', datesToSendAndSave);
  } catch (err) {
    console.log('Error getting from dynamoDB', err);
    throw err;
  }

  try {
    // send message to sns topic

    const textMessage = buildTextMessage(datesToSendAndSave, finalMessage);
    console.log('text message', textMessage);
    // const sendMessage = await sns.publish({
    //   Message: message,
    //   TopicArn: process.env.TOPIC_ARN,
    // }).promise();
    // console.log('Send Message', sendMessage);
  } catch (err) {
    console.log('Error sending info to SNS topic', err);
    throw err;
  }
};
