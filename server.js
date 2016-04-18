"use strict";

const express = require('express');
const packageInfo = require('./package.json');
const bodyParser = require('body-parser');

let app = express();
app.use(bodyParser.json());

app.get('/', function(req, res) {
  res.json({
    version: packageInfo.version
  });
});

const server = app.listen(process.env.PORT, function() {
  let host = server.address().address;
  let port = server.address().port;

  console.log('Web server started at http://%s:%s', host, port);
});

module.exports = function(bot) {
  app.post('/' + bot.token, function(req, res) {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
};
