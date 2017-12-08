const axios = require('axios');
const debug = require('debug')('slash-command-template:slackSearch');
const qs = require('querystring');
const users = require('./users');
const request = require('request');


const sendConfirmation = (slackSearch) => {
  // console.log(slackSearch);
  const field = [];
  for (let i = 0; i < slackSearch.Records.length; i++) {
    field.push({
      title: `${slackSearch.Records[i].fields.Title}`,
      value: slackSearch.Records[i].fields.Link,
    })
  }
  axios.post('https://slack.com/api/chat.postMessage', qs.stringify({
    token: process.env.SLACK_ACCESS_TOKEN,
    channel: slackSearch.userId,
    text: 'View links below',
    attachments: JSON.stringify([
      {
        fields: field,
      },
    ]),
  })).then((result) => {
    debug('sendConfirmation: %o', result.data);
  }).catch((err) => {
    debug('sendConfirmation error: %o', err);
    console.error(err);
  });
};

const arcConfirmation = (slackSearch) => {
  console.log(slackSearch);
  axios.post('https://slack.com/api/chat.postMessage', qs.stringify({
    token: process.env.SLACK_ACCESS_TOKEN,
    // response_type: "in_channel",
    channel: `#${slackSearch.cohort}`,
    text: '@channel',
    attachments: JSON.stringify([
      {
        title: `Ticket created for ${slackSearch.userEmail}`,
        // Get this from the 3rd party helpdesk system
        title_link: 'http://example.com',
        text: slackSearch.text,
        fields: [
          {
            title: 'Link',
            value: slackSearch.arcLink,
          },
          {
            title: 'Title',
            value: slackSearch.arcTitle,
          },
          {
            title: 'Tags',
            value: slackSearch.tags,
          },
          {
            title: 'Cohort',
            value: slackSearch.cohort,
            short: true,
          },
          {
            title: 'Brownbag',
            value: slackSearch.brownbag || 'No',
          }
        ],
      },
    ]),
  })).then((result) => {
    debug('arcConfirmation: %o', result.data);
  }).catch((err) => {
    debug('arcConfirmation error: %o', err);
    console.error(err);
  });
};

const create = (userId, submission) => {
  const slackSearch = {};

  const fetchUserEmail = new Promise((resolve, reject) => {
    users.find(userId).then((result) => {
      debug(`Find user: ${userId}`);
      resolve(result.data.user.profile.email);
    }).catch((err) => { reject(err); });
  });

  fetchUserEmail.then((result) => {
    slackSearch.userId = userId;
    slackSearch.userEmail = result;
    slackSearch.tags = submission.tags;
    slackSearch.cohort = submission.cohort;
    slackSearch.brownbag = submission.brownbag;
    slackSearch.arcLink = submission.arcLink;
    slackSearch.arcTitle = submission.arcTitle;
    if (slackSearch.arcLink) {
      const p = {
        method: 'POST',
        uri: 'https://pacific-waters-60975.herokuapp.com/',
        headers: {
          Authorization: 'Bearer keySPG804go0FXK3F',
          'content-type': 'application/json',
        },
        body: slackSearch,
        json: true
      };
      request(p, (error, response, body) => {
        if (error) {
          console.log(error);
          return;
        }
      });
    } else {
      const g = {
        method: 'GET',
        uri: 'https://pacific-waters-60975.herokuapp.com/',
        headers: {
          Authorization: 'Bearer keySPG804go0FXK3F',
          'content-type': 'application/json',
        },
        body: slackSearch,
        json: true
      };
      request(g, (error, response, body) => {
        if (error) {
          console.log(error);
          return;
        }
      });
    }
  }).catch((err) => { console.error(err); });
};

module.exports = { create, sendConfirmation, arcConfirmation };
