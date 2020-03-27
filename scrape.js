const aws = require('aws-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment');

const documentClient = new aws.DynamoDB.DocumentClient();

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

const params = (arr) => ({
  RequestItems: {
    [process.env.TABLE_NAME]: {
      Keys: arr,
    },
  }
});

exports.handler = async (event) => {
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
    const arrayOfKeys = buildParams(finalMessage);
    const queryDynamoWithEpochDate = await documentClient.batchGet(params(arrayOfKeys)).promise();
    console.log('result from querying dynamoDB', queryDynamoWithEpochDate);
  } catch (err) {
    console.log('Error getting from dynamoDB', err);
    throw err;
  }
};
