const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment');

const dateSelected = 'March 19, 2020' || moment().format('MMMM DD, YYYY');
let dateTracker = dateSelected;
let dateInString = moment(dateSelected).format('MMMM DD, YYYY');
let continueAddingText = true;
const finalMessage = {};
const regexForDate = /(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|Jun(e)?|Jul(y)?|Aug(ust)?|Sep(tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\s+\d{1,2},\s+\d{4}/;
const getWebContent = async () => {
  try {
    const result = await axios.get(
      'https://www.canada.ca/en/revenue-agency/campaigns/covid-19-update.html'
    );
    const $ = cheerio.load(result.data);
    const testing = $('.mwspanel .section').map(async(index, element) => {
      try {
        await buildMessage(element.children);
        for (let key in finalMessage) {
          console.log('Checking key', key);
          finalMessage[key].text =
            finalMessage[key].text.replace(/^\s+|\s+$/g, '');
        }
        console.log('finalMessage', finalMessage);
      } catch (err) {
        console.log('Error each', err);
      }

    }).get();
  } catch (err) {
    console.log('err', err);
  }
};

const buildMessage = async (arr) => {
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
        'https://www.canada.ca/en/revenue-agency/campaigns/covid-19-update.html'
        + arr[i].attribs.href;
    }

    if (arr[i].children) {
      await buildMessage(arr[i].children);
    }
  }
  return finalMessage;
}
getWebContent();
