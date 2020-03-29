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
let originalDate = true;
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
        originalDate = false;
        continue;
      } else if (
        arr[i].data.match(regexForDate)
        && arr[i].data.match(regexForDate)[0] != undefined
        && Date.parse(arr[i].data.match(regexForDate)[0])
        && Date.parse(arr[i].data.match(regexForDate)[0]) === Date.parse(dateInString)
      ) {
        console.log('Equal date', arr[i].data.match(regexForDate)[0]);
        dateTracker = arr[i].data.match(regexForDate)[0];
        originalDate = false;
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
        originalDate = false;
        return;
      }
      console.log('Date trakcer', dateTracker);
      console.log(finalMessage[`${Date.parse(dateTracker)}`])
      console.log('Final text', JSON.stringify(finalMessage));

      if (!originalDate) {
        continueAddingText
          ? (
              finalMessage[`${Date.parse(dateTracker)}`]
                ? finalMessage[`${Date.parse(dateTracker)}`].text += arr[i].data
                : finalMessage[`${Date.parse(dateTracker)}`] = {
                    text: arr[i].data,
                  }
            )
          : i = arr.length;
      }
      console.log('Checking text', finalMessage);
      continue;
    }

    if (arr[i].name === 'a') {
      const keys = Object.keys(finalMessage[Date.parse(dateTracker)]).filter(x => x.includes('link'));
      finalMessage[Date.parse(dateTracker)][`link${keys.length + 1}`] =
        process.env.WEBSITE // https://www.canada.ca
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

const buildUpdateParams = (message) => {
  const arr = [];


  for (let key in message) {
    let tempObj = {};
    const linkKeys = Object.keys(message[key]).filter(x => x.includes('link'));

    for (let linkKey of linkKeys) {
      tempObj[`${linkKey}`] = `${message[key][linkKey]}`;
    }

    arr.push({
      PutRequest: {
        Item: {
          date: key,
          ...tempObj,
        },
      },
    });
  }

  return arr;
};

const paramsForUpdate = (arr) => ({
  RequestItems: {
    [process.env.TABLE_NAME]: arr,
  }
});

const buildTextParts = (arr, numberOfParts, string) => {
  let counter = 650;
  console.log('number of parts', numberOfParts);
  for (let i = 0; i < numberOfParts; i++) {
    if (i === 0) {
      arr.push(
        string.substring(0, counter)
      );
      continue;
    }

    if (i === numberOfParts - 1) {
      arr.push(
        `(Continued)- ${string.substring(counter)}`
      );
      continue;
    }

    arr.push(
      `(Continued)- ${string.substring(counter, counter + 650)}`,
    );
    counter += 650;
  }

  return arr;
};

const buildLinkTextParts = (arr, numberOfParts, string) => {
  let prevCounter = 0;
  let counter = 650;
  console.log('number of parts for links', numberOfParts);
  for (let i = 0; i < numberOfParts; i++) {
    const checkSubstring = string.substring(counter - 1, counter);
    console.log('checking substring', checkSubstring);

    if (!checkSubstring.includes('\n')) {
      console.log('not incldues', checkSubstring);
      counter = string.substring(0, counter).lastIndexOf('link');
      console.log('new counter', counter);
    }

    if (i === numberOfParts - 1) {
      console.log('last', i, numberOfParts - 1);
      arr.push(
        string.substring(prevCounter).trim(),
      );
      continue;
    }

    arr.push(
      string.substring(prevCounter, counter).trim(),
    );
    console.log('arr', arr);
    console.log('counter before', prevCounter, counter);
    prevCounter = counter;
    counter = counter + 650;
    console.log('counter after', prevCounter, counter);
  }

  return arr;
};

const buildTextMessage = (arr, message) => {
  let arrayOfParts = [];

  for (let key of arr) {
    let bodyText = '';
    let linkText = '';
    bodyText += '\n' + `${moment(Number(key)).format(ENUMS.DATE)}: ${message[key].text}`;
    const linkKeys = Object.keys(message[key]).filter(x => x.includes('link'));

    for (let linkKey of linkKeys) {
      linkText += '\n' + `${linkKey}: ${message[key][linkKey]}`;
    }

    console.log('message before trim', bodyText);
    bodyText = bodyText.trim();
    console.log('bodyText after trim', bodyText);

    console.log('link text before trim', linkText);
    linkText = linkText.trim();
    console.log('link text after trim', linkText);

    const bytesSizeOfBodyText = Buffer.byteLength(bodyText, 'utf8');
    const bytesSizeOfLinkText = Buffer.byteLength(linkText, 'utf8');
    console.log('checking size', bytesSizeOfBodyText, bytesSizeOfLinkText, typeof(bytesSizeOfBodyText));

    if (bytesSizeOfBodyText > 650 && bytesSizeOfLinkText > 650) {
      console.log('both text already greater than 650');

      const multiplierForAddingText = Math.ceil(bytesSizeOfBodyText / 650);
      const bytesOfAddingContinuedText = Buffer.byteLength(`(Continued)- `, 'utf8') * multiplierForAddingText;

      const numberOfParts = Math.ceil((bytesSizeOfBodyText + bytesOfAddingContinuedText) / 650);

      arrayOfParts = buildTextParts(arrayOfParts, numberOfParts, bodyText);

      const numberOfPartsForLinks = Math.ceil(bytesSizeOfLinkText / 650);

      arrayOfParts = buildLinkTextParts(arrayOfParts, numberOfPartsForLinks, linkText);
    } else if (bytesSizeOfBodyText > 650 && bytesSizeOfLinkText < 650) {
      console.log('body text greater than 650');

      const multiplierForAddingText = Math.ceil(bytesSizeOfBodyText / 650);
      const bytesOfAddingContinuedText = Buffer.byteLength(`(Continued)- `, 'utf8') * multiplierForAddingText;

      const numberOfParts = Math.ceil((bytesSizeOfBodyText + bytesOfAddingContinuedText) / 650);

      arrayOfParts = buildTextParts(arrayOfParts, numberOfParts, bodyText);
      arrayOfParts.push(linkText);
    } else if (bytesSizeOfLinkText > 650 && bytesSizeOfBodyText < 650) {
      console.log('link size bigger');
      arrayOfParts.push(bodyText);

      const numberOfPartsForLinks = Math.ceil(bytesSizeOfLinkText / 650);

      arrayOfParts = buildLinkTextParts(arrayOfParts, numberOfPartsForLinks, linkText);
    } else {
      console.log('both smaller');
      console.log('checking text', bodyText, linkText);
      console.log(Buffer.byteLength(bodyText + linkText, 'utf8'));
      if (Buffer.byteLength(bodyText + linkText, 'utf8') > 650) {
        arrayOfParts.push(
          bodyText
        );

        arrayOfParts.push(
          linkText,
        );
      } else {
        arrayOfParts.push(
          bodyText + '\n' + linkText
        );
      }
    }
    console.log('array of parts', arrayOfParts);
  }
  console.log('final of parts', arrayOfParts);
  return arrayOfParts;
};

const sleep = (ms) => {
  console.log('should see each second')
  return new Promise(resolve => setTimeout(resolve, ms));
};

exports.handler = async (event) => {
  let datesToSendAndSave = [];
  try {
    console.log('Invoked with event', event);
    console.log('Check!', `${process.env.WEBSITE}${event.PATH}`)
    const result = await axios.get(
      `${process.env.WEBSITE}${event.PATH}`
    );
    const $ = cheerio.load(result.data);

    const loopSite = $('.mwsbodytext').map((index, element) => {
      console.log('$', $);
      buildMessage(element.children);
      for (let key in finalMessage) {
        finalMessage[key].text =
          finalMessage[key].text.replace(/^\s+|\s+$/g, '');
      }
    }).get();
    console.log('get links', $('a').text());
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
    console.log('check length of parts', textMessage.length);

    for (let message of textMessage) {
      await sleep(1000);
      console.log('message before sending', message);
      const sendMessage = await sns.publish({
        Message: message,
        TopicArn: process.env.TOPIC_ARN,
      }).promise();
      console.log('Result from sending Message to topic', sendMessage);
    }
  } catch (err) {
    console.log('Error sending info to SNS topic', err);
    throw err;
  }

  try {
    const arrayOfUpdateParams = buildUpdateParams(finalMessage);
    const batchOfUpdateParams = batchItems(arrayOfUpdateParams, 25);
    const batchUpdateDynamoDB = await Promise.all(batchOfUpdateParams.map(async (updateInfo) => {
      try {
        const resultFromBatchUpdate = await documentClient.batchWrite(paramsForUpdate(updateInfo)).promise();
        console.log('result from batch update', JSON.stringify(resultFromBatchUpdate));
      } catch (err) {
        console.log('Error batch getting items', err);
        throw err;
      }
    }));
  } catch (err) {
    console.log('Error updating dynamoDB', err);
    throw err;
  }
};
