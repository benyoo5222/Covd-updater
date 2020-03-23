const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment');

let dateSelected = null || 'march 19 2020';
let dateInString = moment(dateSelected).format('MMMM DD, YYYY');
let continueAddingText = true;
const finalMessage = {
  [Date.parse(dateInString)]: {
    text: '',
  },
};
const regexForDate = /(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|Jun(e)?|Jul(y)?|Aug(ust)?|Sep(tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\s+\d{1,2},\s+\d{4}/;
const test = async () => {
  try {
    const result = await axios.get(
      'https://www.canada.ca/en/revenue-agency/campaigns/covid-19-update.html'
    );
    const $ = cheerio.load(result.data);
    const testing = $('.mwspanel .section').map(async(index, element) => {
      try {
        await buildMessage(element.children)
        finalMessage[Date.parse(dateInString)].text =
          finalMessage[Date.parse(dateInString)].text.replace(/^\s+|\s+$/g, '');
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
        Date.parse(arr[i].data)
        && Date.parse(arr[i].data) >= Date.parse(dateInString)
      ) {
        dateSelected = arr[i].data;
        console.log('Changed date', dateSelected);
        const testMatch = arr[i].data.match(regexForDate);
        console.log('test Match',testMatch);
        continue;
      } else if (
        Date.parse(arr[i].data)
        && Date.parse(arr[i].data) < Date.parse(dateInString)
      ) {
        const testMatch = arr[i].data.match(regexForDate);
        console.log('test Match',testMatch);
        continueAddingText = false;
        return;
      }
      console.log('date', Date.parse(dateInString))
      continueAddingText
        ? finalMessage[Date.parse(dateInString)].text += arr[i].data
        : i = arr.length;
      continue;
    }

    if (arr[i].name === 'a') {
      const keys = Object.keys(finalMessage[Date.parse(dateInString)]).filter(x => x.includes('link'));
      finalMessage[Date.parse(dateInString)][`link${keys.length + 1}`] =
        'https://www.canada.ca/en/revenue-agency/campaigns/covid-19-update.html'
        + arr[i].attribs.href;
    }

    if (arr[i].children) {
      await buildMessage(arr[i].children);
    }
  }
  return finalMessage;
}
test();
