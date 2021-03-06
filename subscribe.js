const aws = require('aws-sdk');
const sns = new aws.SNS();

const TopicArn = process.env.TOPIC_ARN;
const subscriptionList = process.env.LIST_OF_SUBSCRIPTION_METHODS.split(',');

const subscribeParams = (
  protocol,
  endPoint,
) => ({
  Protocol: protocol,
  Endpoint: endPoint,
  ReturnSubscriptionArn: true,
  TopicArn,
});

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

const sleep = (ms) => {
  console.log('should see each second')
  return new Promise(resolve => setTimeout(resolve, ms));
};

exports.handler = async (event) => {
  try {
    console.log('Invoked with event', JSON.stringify(event));
    const subscriptionInfo = JSON.parse(event.body);

    const listOfParams = subscriptionList.map(subscription => {
      return subscriptionInfo[subscription]
        ? subscribeParams(subscription, subscriptionInfo[subscription])
        : null;
    }).filter(x => x !== null);
    console.log('list of params', listOfParams);

    if (listOfParams.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'Please select a subcription method.',
        }),
      };
    }

    const batchOfSubscribeParams = batchItems(listOfParams, 100);
    console.log('Batch of params', batchOfSubscribeParams);
    console.log('batch of subscribe params', batchOfSubscribeParams);
    const promises = [];
    const responses = [];

    batchOfSubscribeParams.forEach(batch => {
      batch.forEach(params => {
        console.log('Checkin each Param', params);
        promises.push(
          sns.subscribe(params).promise()
            .then(result => responses.push(result))
            .catch(err => {
              console.log('Error subscribing inside loop', err);
              throw err;
            })
        );
      });
    });

    await Promise.all(promises);
    console.log('Result', responses);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Successfully subscribed to the topic',
      }),
    };
  } catch (err) {
    console.log('Error subscribing', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Server Error',
      }),
    };
  }
};
