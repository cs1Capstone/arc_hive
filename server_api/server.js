require('dotenv').config(); // ?
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const request = require('request');
const mongodb = require('mongodb'); // ?
const port = process.env.PORT || 5001;
const Airtable = require('airtable');
const slackModel = require('./slackModel');
const slackSearch = require('./search');
const axios = require('axios');
const qs = require('querystring');
const debug = require('debug')('slash-command-template:index');
const users = require('./users.js');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const readline = require('readline'); // ?
const google = require('googleapis');
const ytAPI = google.youtube('v3');
const util = require('util');
const googleAuth = require('google-auth-library');
const opn = require('opn'); // ?
const GoogleStrategy = require('passport-google-oauth2').Strategy; // ?
const passport = require('passport'); // ?
const AWS = require('aws-sdk'); // ?
const path = require('path'); // ?
const authorizedMembers = require('./members');

// This code is worthless garbage
// Airtable.configure({
//   endpointUrl: 'https://api.airtable.com/v0/appMs812ZOuhtf8Un/Table%201',
//   apiKey: process.env.AIR_TABLE_KEY
// });
// let base = Airtable.base('appMs812ZOuhtf8Un');
//

const server = express();

// Sets up scope of permitted actions to YouTube
const SCOPES = ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.upload'];

// YouTube credentials
const creds = {
  client_secret: process.env.YOUTUBE_CLIENT_SECRET,
  client_id: process.env.YOUTUBE_CLIENT_ID,
  redirect_uri: 'https://pacific-waters-60975.herokuapp.com/auth-confirmation',
};

// Google Api declarations for authorized YouTube access
const auth = new googleAuth();
let oAuthTraveler = new auth.OAuth2(creds.client_id, creds.client_secret, creds.redirect_uri);
const tokePath = path.join(__dirname, 'creds.json');

// Not Using but save for now
// mongoose.Promise = global.Promise;
// mongoose.connect('mongodb://localhost/arc_hive', {useMongoClient: true});

// BodyParser boilerplate
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({extended: true}));

/*=======================================================================
=========================================================================
* AUTHORIZATION ROUTES:
* Authorizes the user to interact with YouTube
* Confirm access token before proceeding with the rest of the program (first route hit)
=========================================================================
========================================================================*/

/*************************************************************************
* ==============INITIAL YOUTUBE AUTH ROUTE==============
**************************************************************************/
server.get('/auth', (req, res) => {
  // ADD: If statement to check for valid token
    // If valid token redirect to /slackzoom
  const getNewToken = (oAuthTraveler) => {
    const authUrl = oAuthTraveler.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES
    });

    res.redirect(authUrl);
  };

  getNewToken(oAuthTraveler);
});

/*************************************************************************
* ==============CONFIRMATION YOUTUBE AUTH ROUTE==============
**************************************************************************/
server.get('/auth-confirmation', (req, res) => {
  const code = req.query.code;

  const receiveToken = (code) => {
    oAuthTraveler.getToken(code, ((err, token) => {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }

      oAuthTraveler.credentials = token;

      fs.writeFile(tokePath, JSON.stringify(oAuthTraveler), (err) => {
        if (err) {
          console.log(`91: ${err}`);
        }
        console.log('Authorization successful. Google OAuth2 Token saved. Ready for /startzoom.');
      });
    }));
  };

  receiveToken(code);
  res.status(200);
  res.send('You are now Authorized');
});

/*=======================================================================
=========================================================================
* AIRTABLE ROUTES
=========================================================================
========================================================================*/

/*************************************************************************
* =============AIRTABLE QUERY-GET ROUTE==============
* -This route is triggered when the 'create' function in search.js sends
* an HTTP request containing the search parameters
**************************************************************************/
server.get('/', (req, res) => {
  let tagVal = req.body.tags;
  let cohortVal = req.body.cohort;
  const brownBagVal = req.body.brownbag;
  let sortParam = 'asc'
  if (req.body.sort) {
    sortParam = req.body.sort;
  }
  if (tagVal) {
    tagVal = tagVal.toUpperCase();
  }
  if(cohortVal) {
    cohortVal = cohortVal.toUpperCase();
  }
  const path = {
    allRec: 'https://api.airtable.com/v0/appMs812ZOuhtf8Un/tblWIvD0du6JQqdlx?filterByFormula=',
    onlyBrownBags: 'IF(Brownbag%2C+Link)',
    noBrownBags: 'IF(NOT(Brownbag)%2C+Link)',
    cohort: 'OR(IF(FIND(%22' + cohortVal + '%22%2C+ARRAYJOIN(Cohort%2C+%22+%22))%2C+Link)%2C+IF(FIND(%22all%22%2C+ARRAYJOIN(Cohort%2C+%22+%22))%2C+Link))',
    tags: 'IF(FIND(%22' + tagVal + '%22%2C+ARRAYJOIN(Tags%2C+%22+%22))%2C+Link)',
    sort: '&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=' + sortParam
  };
  const pathArray = [];
  let url = path.allRec;
  if (tagVal) {
    pathArray.push(path.tags);
  }
  if (cohortVal) {
    pathArray.push(path.cohort);
  }
  if (brownBagVal) {
    pathArray.push(path[brownBagVal]);
  }
  if (pathArray.length === 1) {
    url += pathArray[0];
  } else if (pathArray.length > 1) {
    url += 'AND(' + pathArray.join('%2C+') + ')';
  }

  const g = {
    method: 'GET',
    uri: url + path.sort,
    headers: {
      Authorization: process.env.AIR_TABLE_KEY,
      'content-type': 'application/json',
    },
    json: true
  };
  request(g, (error, response, body) => {
    if (error) {
      console.log(error);
      return;
    }
    if (sortParam === 'asc') {
      sortParam = 'oldest to newest';
    } else {
      sortParam = 'newest to oldest'
    }
    const sendToSlack = {
      Records: body.records,
      userId: req.body.userId,
      tags: tagVal,
      cohort: cohortVal,
      brownbag: brownBagVal,
      sortParam: sortParam
    };
    // console.log(sendToSlack);
    slackSearch.sendConfirmation(sendToSlack);
    res.send(body);
  });
});

/*************************************************************************
* =============AIRTABLE CREATE-POST ROUTE==============
**************************************************************************/
server.post('/', (req, res) => {

  let brownbag = null;
  let cohort = ['N/A'];
  let tags = ['N/A'];
  let link = req.body.arcLink;
  if (req.body.description) {
    const temp = req.body.description.toUpperCase().split(': ');

    cohort = [temp[0]];
    tags = temp[1].split(', ');
  }
  if (req.body.cohort) {
    cohort = req.body.cohort.toUpperCase().split(', ');
  }

  // Not in use
  // if (req.body.arcTime) {
  //   link += '?t=' + req.body.arcTime;
  // }

  if (req.body.tags) {
    tags = req.body.tags.toUpperCase().split(', ');
  }
  if (req.body.brownbag) {
    brownbag = true;
  }
  const p = {
    method: 'POST',
    uri: 'https://api.airtable.com/v0/appMs812ZOuhtf8Un/Table%201',
    headers: {
      Authorization: process.env.AIR_TABLE_KEY,
      'content-type': 'application/json',
    },
    body: {
      "fields": {
        Link: link,
        Title: req.body.arcTitle,
        Cohort: cohort,
        Tags: tags,
      }
    },
    json: true
  };
  request(p, (error, response, body) => {
    if (error) {
      console.log(error);
      return;
    }
    console.log(`YouTube link, cohort, and content tags have been successfully entered in AirTable.`);
    if (body.error) {
      const errorData = {
        error: body.error,
        user: req.body.userId
      }
      slackSearch.airTableError(errorData);
    } else {
      const slackData = {
        "cohort": body.fields.Cohort,
        "arcTitle": body.fields.Title,
        "arcLink": body.fields.Link,
      };

      if (req.body.userId) {
        slackData.userId = req.body.userId;
      }
      if (typeof(slackData.cohort) === 'object') {
        slackData.cohort = slackData.cohort.join(', ');
      }
      slackSearch.arcConfirmation(slackData);
    }
    res.send(JSON.stringify(body));
  });
});

/*=======================================================================
=========================================================================
* SLACK ROUTES
=========================================================================
========================================================================*/

/*************************************************************************
* =============SLACK COMMANDS-POST ROUTE==============
**************************************************************************/
server.post('/commands', (req, res) => {
  // extract the verification token, slash command text,
  // and trigger ID from payload
  const { token, text, trigger_id } = req.body;

  // check that the verification token matches expected value
  if (token === process.env.SLACK_VERIFICATION_TOKEN) {
    // create the dialog payload - includes the dialog structure, Slack API token,
    // and trigger ID
    const dialog = {
      token: process.env.SLACK_ACCESS_TOKEN,
      trigger_id,
      dialog: JSON.stringify({
        title: 'LS Videos',
        callback_id: 'submit-search',
        submit_label: 'Submit',
        elements: [
          {
            label: 'Tags',
            type: 'text',
            name: 'tags',
            optional: true,
            hint: 'Enter tag(s) separated by commas e.g. brownbag, code challenge, react (note: only videos with tags matching ALL params are returned)'
          },
          {
            label: 'Cohort',
            optional: true,
            type: 'text',
            name: 'cohort',
            hint: 'Enter cohort(s) in the same format as above e.g. CS1, CS2 To get all videos regardless of cohort leave this field blank.'
          },
          /* {
            label: 'Brownbag?',
            optional: true,
            type: 'select',
            name: 'brownbag',
            options: [
              { label: 'Only Brownbags', value: 'onlyBrownBags' },
              { label: 'No Brownbags', value: 'noBrownBags' },
            ]
          }, */
          {
            label: 'Sorted By',
            optional: true,
            type: 'select',
            name: 'sort',
            value: 'asc',
            options: [
              { label: 'Newest First', value: 'desc' },
              { label: 'Oldest First', value: 'asc' },
            ]
          },
        ],
      }),
    };

    // open the dialog by calling dialogs.open method and sending the payload
    axios.post('https://slack.com/api/dialog.open', qs.stringify(dialog))
      .then((result) => {
        debug('dialog.open: %o', result.data);
        res.send('');
      }).catch((err) => {
        debug('dialog.open call failed: %o', err);
        res.sendStatus(500);
      });
  } else {
    debug('Verification token mismatch');
    res.sendStatus(500);
  }
});

/*************************************************************************
* ==============SLACK INTERACTIVE-COMPONENT-POST ROUTE==============
**************************************************************************/
server.post('/interactive-component', (req, res) => {
  const body = JSON.parse(req.body.payload);
  console.log(JSON.stringify(body));

  // check that the verification token matches expected value
  if (body.token === process.env.SLACK_VERIFICATION_TOKEN) {
    debug(`Form submission received: ${body.submission.trigger_id}`);

    // immediately respond with a empty 200 response to let
    // Slack know the command was received
    res.send('');

    // create Helpdesk ticket
    const findAuthorizedMembers = (userId, submission) => {
      const fetchAuthorizedMembers = new Promise((resolve, reject) => {
        authorizedMembers.memberList(userId).then((result) => {
          debug(`Get member list`);
          resolve(result.data.members);
        }).catch((err) => { reject(err); });
      });

      fetchAuthorizedMembers.then((result) => {
        console.log(result);
        slackSearch.create(userId, submission, result)
      })
    }
    console.log(body.user.id);
    findAuthorizedMembers(body.user.id, body.submission);
  } else {
    debug('Token mismatch');
    res.sendStatus(500);
  }
});

/*************************************************************************
* ==============SLACK ARCCOMMANDS-POST ROUTE==============
**************************************************************************/
server.post('/arcCommands', (req, res) => {
  // extract the verification token, slash command text,
  // and trigger ID from payload
  const { token, text, trigger_id, user_id } = req.body;

  const findUser = (userId) => {

    const fetchUserName = new Promise((resolve, reject) => {
      users.find(userId).then((result) => {
        debug(`Find user: ${userId}`);
        resolve(result.data.user.profile.real_name);
      }).catch((err) => { reject(err); });
    });

    fetchUserName.then((result) => {
      openDialog(result);
      return;
    }).catch((err) => { console.error(err); });
  };

  findUser(user_id);
  // check that the verification token matches expected value
  const openDialog = (userName) => {
    if (token === process.env.SLACK_VERIFICATION_TOKEN) {
      // create the dialog payload - includes the dialog structure, Slack API token,
      // and trigger ID
      const dialog = {
        token: process.env.SLACK_ACCESS_TOKEN,
        trigger_id,
        dialog: JSON.stringify({
          title: 'LS Videos',
          callback_id: 'submit-search',
          submit_label: 'Submit',
          elements: [
            {
              label: 'Enter video link here',
              type: 'text',
              name: 'arcLink',
              value: text,
            },
            {
              label: 'Enter video title',
              type: 'text',
              name: 'arcTitle',
              value: `[Title] by ${userName}`,
              hint: 'Replace "[Title]" with your title',
            },
            // {
            //   label: 'Password',
            //   type: 'text',
            //   name: 'password',
            // },
            {
              label: 'Tags',
              type: 'text',
              name: 'tags',
              optional: true,
              hint: 'Add tags separated by a comma. Ex: React, Redux, Brownbag',
            },
            {
              label: 'Cohort',
              type: 'text',
              name: 'cohort',
              optional: true,
              hint: 'Entering multiple cohorts is the same as entering multiple tags. To add all cohorts enter "all".'
            },
            // {
            //   label: 'Brownbag?',
            //   optional: true,
            //   type: 'select',
            //   name: 'brownbag',
            //   options: [
            //     { label: 'Yes', value: true },
            //   ]
            // }
          ],
        }),
      };

      axios.post('https://slack.com/api/dialog.open', qs.stringify(dialog))
        .then((result) => {
          debug('dialog.open: %o', result.data);
          res.send('');
        }).catch((err) => {
          debug('dialog.open call failed: %o', err);
          res.sendStatus(500);
        });
    } else {
      debug('Verification token mismatch');
      res.sendStatus(500);
    }
  }
});

/*************************************************************************
* ==============SLACK ARCCOMMANDS-POST ROUTE==============
**************************************************************************/
// server.post('/timestamp', (req, res) => {
//   const { token, text, trigger_id, user_id } = req.body;
//
//   const findUser = (userId) => {
//
//     const fetchUserName = new Promise((resolve, reject) => {
//       users.find(userId).then((result) => {
//         debug(`Find user: ${userId}`);
//         resolve(result.data.user.profile.real_name);
//       }).catch((err) => { reject(err); });
//     });
//
//     fetchUserName.then((result) => {
//       openDialog(result);
//       return;
//     }).catch((err) => { console.error(err); });
//   };
//
//   findUser(user_id);
//
//   const openDialog = (userName) => {
//     if (token === process.env.SLACK_VERIFICATION_TOKEN) {
//       const dialog = {
//         token: process.env.SLACK_ACCESS_TOKEN,
//         trigger_id,
//         dialog: JSON.stringify({
//           title: 'add a timestamp',
//           callback_id: 'submit-search',
//           submit_label: 'Submit',
//           elements: [
//             {
//               label: 'Video Link',
//               type: 'text',
//               name: 'arcLink',
//               value: text,
//             },
//             {
//               label: 'Video Title',
//               type: 'text',
//               name: 'arcTitle',
//             },
//             {
//               label: 'Password',
//               type: 'text',
//               name: 'password'
//             },
//             // {
//             //   label: 'Instructor',
//             //   type: 'text',
//             //   name: 'arcInstructor',
//             //   value: userName,
//             // },
//             {
//               label: 'Enter time',
//               type: 'text',
//               name: 'arcTime',
//               hint: 'e.g. 1h2m35s'
//             },
//             {
//               label: 'Tags',
//               type: 'text',
//               name: 'tags',
//             },
//           ],
//         }),
//       };
//
//       axios.post('https://slack.com/api/dialog.open', qs.stringify(dialog))
//         .then((result) => {
//           debug('dialog.open: %o', result.data);
//           res.send('');
//         }).catch((err) => {
//           debug('dialog.open call failed: %o', err);
//           res.sendStatus(500);
//         });
//     } else {
//       debug('Verification token mismatch');
//       res.sendStatus(500);
//     }
//   };
// });

/*=======================================================================
=========================================================================
* ZOOM ROUTES
=========================================================================
========================================================================*/

/*************************************************************************
* ==============ZOOM CREATE ROUTE==============
**************************************************************************/

server.post('/zoom', (req, res) => { // Changed get to post

  const payload = {
    "iss": process.env.ZOOM_KEY,
    "exp": Math.floor(Date.now() / 1000) + (60 * 60)
  };

  const token = jwt.sign(payload, process.env.ZOOM_SECRET);

  const z = {
    method: 'POST',
    uri: 'https://api.zoom.us/v2/users/' + req.body.zoomEmail + '/meetings',
    headers: {
      Authorization: 'Bearer' + token,
      "alg": 'HS256',
      "typ": 'JWT',
    },
    body: {
      "topic": req.body.topic + ';' + req.body.cohort + ': ' + req.body.tags,
      "type": 1,
      "host_id": "268933",
      "agenda": req.body.cohort + ';' + req.body.tags,
      "settings": {
        "auto_recording": "cloud",
      },
    },
    json: true
  };

  request(z, (error, response, body) => {
    if (error) {
      console.log(error);
      return;
    }
    const zoomData = {
      cohort: req.body.cohort,
      zoomLink: body.join_url,
      title: req.body.topic
    }
    console.log(`Zoom meeting successfully created. Sending Zoom link and lecture title to cohort channel.`);
    slackSearch.startZoom(zoomData);
    res.send(response);
  });
  // res.send('ZOOM ZOOM');
});

/*************************************************************************
* ==============ZOOM-SLACK ROUTE==============
**************************************************************************/

server.post('/slackzoom', (req, res) => {
  const { token, text, trigger_id, user_id } = req.body;

  if (token === process.env.SLACK_VERIFICATION_TOKEN) {

    const testValidation = JSON.parse(fs.readFileSync(tokePath, 'utf8'));

    if (testValidation.credentials) {
      const validationURI = `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${testValidation.credentials.access_token}`;
      request(validationURI, (err, response, body) => {
        if (err) {
          console.log(err);
        } else {
          console.log(`YouTube authorization successful. Sending StartZoom menu to Slack.`);
          const dialog = {
            token: process.env.SLACK_ACCESS_TOKEN,
            trigger_id,
            dialog: JSON.stringify({
              title: 'Start a zoom meeting',
              callback_id: 'submit-search',
              submit_label: 'Submit',
              elements: [
                {
                  label: 'Title of lecture',
                  type: 'text',
                  name: 'topic',
                  value: text,
                },
                {
                  label: 'Zoom email address',
                  type: 'text',
                  name: 'zoomEmail',
                },
                // {
                //   label: 'Password',
                //   type: 'text',
                //   name: 'password',
                // },
                {
                  label: 'Cohort',
                  type: 'text',
                  name: 'cohort',
                },
                {
                  label: 'Tags',
                  optional: true,
                  type: 'text',
                  name: 'tags',
                },
              ],
            }),
          };

          axios.post('https://slack.com/api/dialog.open', qs.stringify(dialog))
            .then((result) => {
              debug('dialog.open: %o', result.data);
              res.send('');
            }).catch((err) => {
              debug('dialog.open call failed: %o', err);
              res.sendStatus(500);
            });
        }
      });
    } else {
      console.log(`Youtube authorization failed. Sending authorization link to Slack.`);
      axios.post('https://slack.com/api/chat.postMessage', qs.stringify({
        token: process.env.SLACK_ACCESS_TOKEN,
        channel: user_id,
        text: `You are not logged in. Please click the authorization link below and try again`,
        attachments: JSON.stringify([
          {
            fields: [{
              title: 'Authorization Page',
              value: 'https://pacific-waters-60975.herokuapp.com/auth'
            }],
          },
        ]),
      })).then((result) => {
        debug('sendConfirmation: %o', result.data);
      }).catch((err) => {
        debug('sendConfirmation error: %o', err);
        console.error(err);
      });
    }

  } else {
    debug('Verification token mismatch');
    res.sendStatus(500);
  }
});

/*************************************************************************
* ==============ZOOM-RECORDING ROUTE==============
**************************************************************************/

server.post('/recordings', (req, res) => {

  if (req.body.type === 'RECORDING_MEETING_COMPLETED') {
    console.log(`Zoom cloud recording successfully processed.`);
    const p = JSON.parse(req.body.content);

    const payload = {
      "iss": process.env.ZOOM_KEY,
      "exp": Math.floor(Date.now() / 1000) + (60 * 60)
    };
    const token = jwt.sign(payload, process.env.ZOOM_SECRET);
    const g = {
      method: 'GET',
      uri: 'https://api.zoom.us/v2/meetings/' + p.uuid + '/recordings',
      headers: {
        Authorization: 'Bearer' + token,
        "alg": 'HS256',
        "typ": 'JWT',
      },
      json: true
    };
    request(g, (error, response, body) => {
      if (error) {
        console.log(error);
        return;
      }
      console.log(`Successfully retrieved Zoom cloud recording metadata. Preparing metadata to be sent to YouTube.`);
      const createResource = (properties) => {
        const resource = {};
        const normalizedProps = properties;
        for (let p in properties) {
          const value = properties[p];
          if (p && p.substr(-2, 2) == '[]') {
            const adjustedName = p.replace('[]', '');
            if (value) {
              normalizedProps[adjustedName] = value.split(',');
            }
            delete normalizedProps[p];
          }
        }
        for (let p in normalizedProps) {
          if (normalizedProps.hasOwnProperty(p) && normalizedProps[p]) {
            const propArray = p.split('.');
            let ref = resource;
            for (var pa = 0; pa < propArray.length; pa++) {
              const key = propArray[pa];
              if (pa == propArray.length - 1) {
                ref[key] = normalizedProps[p];
              } else {
                ref = ref[key] = ref[key] || {};
              }
            }
          };
        }
        return resource;
      };

      const videosInsert = (requestData, creds) => {

        const gAuth = JSON.parse(fs.readFileSync(tokePath, 'utf8'));
        const auth = new googleAuth();
        const oauth2Client = new auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUrl);
        oauth2Client.credentials = gAuth.credentials;
        const service = google.youtube('v3');
        const parameters = requestData['params'];
        parameters['auth'] = oauth2Client;
        parameters['media'] = {
          "body": fs.createReadStream(__dirname + '/LECTUREVIDEO.mp4'),                       // request(requestData.mediaFilename).pipe(fs.createWriteStream('LECTUREVIDEO.mp4')),
          "mimeType": "video/mp4"
        };
        parameters['notifySubscribers'] = false;
        parameters['resource'] = createResource(requestData['properties']);

        service.videos.insert(parameters, ((err, data) => {
          if (err) {
            console.log('The API returned an error: ' + err);
          }
          if (data) {
            // if success...
            console.log(`Video successfully uploaded to YouTube. Video metadata:`)
            console.log(util.inspect(data, false, null));

            // Options object used to make the delete request to Zoom
            const trash = {
              method: 'DELETE',
              uri: 'https://api.zoom.us/v2/meetings/' + p.uuid + '/recordings',
              headers: {
                Authorization: 'Bearer' + token,
                "alg": 'HS256',
                "typ": 'JWT',
              },
              json: true
            };

            // Request to Zoom that moves the uploaded video to trash
            request(trash, (err, response, body) => {
              if (err) {
                console.log(err);
              } else {
                console.log(`Zoom cloud recording successfully moved to cloud trash bin.`);
              }
            });

            // Options object used in the request to /
            const paste = {
              method: 'POST',
              uri: 'https://pacific-waters-60975.herokuapp.com/',
              headers: {
                Authorization: process.env.AIR_TABLE_KEY,
                'content-type': 'application/json',
              },
              body: {
                arcLink: 'https://youtu.be/' + data.id,
                description: data.snippet.description,
                arcTitle: data.snippet.title,
              },
              json: true
            };

            // Post request to / (which is an AirTable route) sending the YouTube link
            request(paste, (err, response, body) => {
              if (err) {
                console.log(err);
              } else {
                console.log(`Sending YouTube link and metadata to AirTable`);
              }
            });
          }

        }));
      };
      const temp = body.topic.split(';');
      const description = temp[1];
      const title = temp[0];
      const params = {
        'params': {
          'part': 'snippet,status'
        },
        'properties': {
          'snippet.categoryId': '22',
          'snippet.description': description,
          'snippet.title': title,
          'status.privacyStatus': 'unlisted',
          'status.publicStatsViewable': '',
          'snippet.defaultLanguage': '',
          'snippet.tags[]': '',
          'status.embeddable': '',
          'status.license': '',
          },
          'mediaFilename': '',
        };

        request(body.recording_files[0].download_url).pipe(fs.createWriteStream(__dirname + '/LECTUREVIDEO.mp4')).on('finish', () => {
          videosInsert(params, creds);
        });

        // cWS.on('open', () => {
        //
        // });
      res.send('It probably worked');
    });
  } else {
    res.status(200);
    res.send(req.body.type);
  }

});

server.listen(port, () => {
  console.log(`Servs up dude ${port}`);
});

/*
const MONGO_URL = 'mongodb://arc_hive_admin:arc hive 555@ds013475.mlab.com:13475/arc_hive_testdb';

MongoClient.connect(MONGO_URL, (err, db) => {
  if (err) {
    return console.log(err);
  }

  // Do something with db here, like inserting a record
  db.collection('arc_hive_testdb').insertOne(
    {
      text: 'Hopefully this works!'
    },
    function (err, res) {
      if (err) {
        db.close();
        return console.log(err);
      }
      // Success
      db.close();
    }
  )
});
*/
