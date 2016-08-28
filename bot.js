'use strict';

require('newrelic');
const Messages = require('./messages.json');
const curl = require('curlrequest');
const API_URL = process.env.API_URL;
const botan = require('botanio')(process.env.BOTAN_TOKEN);

const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TOKEN;
const ownerChatId = 3378577;

let redis;
if (process.env.REDIS_URL) {
  const redisUrl = require('url').parse(process.env.REDIS_URL);
  redis = require('redis').createClient(redisUrl.port, redisUrl.hostname);
  redis.auth(redisUrl.auth.split(':')[1]);
} else {
  redis = require('redis').createClient();
}

redis.on('error', function(err) {
  console.log('Error: ', err);
});

let bot;
if (process.env.NODE_ENV === 'production') {
  bot = new TelegramBot(token);
  bot.setWebHook(process.env.HEROKU_URL + bot.token);
} else {
  bot = new TelegramBot(token, {
    polling: true
  });
}

const onayChunkNumbers = {
  standart: '96431085033',
  student: '96439085033'
};

let onayTypeId = 0;

bot.getMe().then(function(me) {
  console.info('Onay bot %s initialized!', me.username);
}).catch(function(err) {
  throw new Error(err);
});

bot.onText(/\/start/, function(message) {
  const chatId = message.chat.id;
  botan.track(message, 'Start');
  bot.sendMessage(chatId, Messages.welcome);
});

var getBalance = (chatId, pan, type, message, fromMemory) => {
  bot.sendChatAction(chatId, 'typing');
  if (pan && pan.length) {
    if (parseFloat(process.env.IS_ONAY_DOWN)) {
      bot.sendMessage(chatId, Messages.onayBanned);
    }
    var cleanedPan = pan.replace(/\s/g, '');
    var panLength = cleanedPan.length;
    if (panLength && !isNaN(cleanedPan)) {
      botan.track(message, 'Balance');
      if (panLength === 19 || panLength === 8) {
        const currentPan = panLength === 8 ? onayChunkNumbers[type] + cleanedPan : cleanedPan;
        const requestOptions = {
          url: API_URL + currentPan
        };
        curl.request(requestOptions, function(err, data) {
          let isDataJson = true;
          let curlData;
          try {
            curlData = JSON.parse(data);
          } catch (JSONErr) {
            isDataJson = false;
          }
          if (curlData && curlData.errordetail && curlData.errordetail.length) {
            console.error(err);
            bot.sendMessage(ownerChatId, '#ошибкаОнай: ' + curlData.errordetail);
            bot.sendMessage(chatId, Messages.systemError);
          } else if (isDataJson) {
            const cardData = curlData;
            // let example = {
            //   result: {
            //     pan: "9643108503304055603",
            //     shortPan: "9850330405560106",
            //     stopList: false,
            //     type: "01.01",
            //     name: "ETK-OnLine",
            //     balance: 120000
            //   },
            //   type: true,
            //   message: "OK"
            // };
            if (cardData.result.type) {
              const balance = cardData.result.balance / 100;
              const tripsCount = {
                standart: parseInt(balance / 80),
                benefit: parseInt(balance / 40)
              };
              // TODO: Improve message creating
              let messageText = `Номер карты: *${currentPan}*; \nВаш баланс: *${balance}* тенге; \n`;
              messageText += cardData.result.type !== '01.01' ? 'У вас льготная карта \n' : '';
              messageText += cardData.result.type === '01.01' ? `Количество поездок: *${tripsCount.standart}*;\n` : `Количество поездок: *${tripsCount.benefit}*;\n`;
              console.info(messageText);
              bot.sendMessage(chatId, messageText, {
                parse_mode: 'Markdown'
              });
              console.info('Card Number: ' + currentPan + '; Balance: ' + balance);
              onayTypeId = 0;
            } else {
              onayTypeId++;
              const onayTypeKey = Object.keys(onayChunkNumbers)[onayTypeId];
              if (onayTypeKey) {
                getBalance(chatId, pan, onayTypeKey, message, fromMemory);
              } else {
                bot.sendMessage(chatId, Messages.cardNotFound);
                onayTypeId = 0;
              }
            }
          }
        });
      } else {
        bot.sendMessage(chatId, Messages.panError);
      }
    } else {
      bot.sendMessage(chatId, Messages.panError);
    }
  } else {
    bot.sendMessage(chatId, Messages.panError);
  }
};

bot.onText(/\/savecard (.+)/, function(message, match) {
  const chatId = message.chat.id;
  const userPan = match[1];
  bot.sendChatAction(chatId, 'typing');
  botan.track(message, 'Save card pan');
  redis.set(chatId, userPan);
  bot.sendMessage(chatId, Messages.cardSaved);
});

bot.onText(/\/getcard/, function(message) {
  const chatId = message.chat.id;
  botan.track(message, 'Get balance fast');
  redis.get(chatId, function(err, reply) {
    if (reply) {
      getBalance(chatId, reply, 'standart', message, true);
    } else {
      bot.sendMessage(chatId, Messages.cardNotSaved);
    }
  });
});

bot.onText(/\/getbalance (.+)/, function(message, match) {
  const chatId = message.chat.id;
  const resp = match[1];
  getBalance(chatId, resp, 'standart', message);
});

bot.onText(/^[0-9]{8,19}$/, function(message) {
  const chatId = message.chat.id;
  getBalance(chatId, message.text, 'standart', message);
});

bot.onText(/\/feedback (.+)/, function(message, match) {
  const USER = message.from.username || message.from.id;
  const feedbackMessage = match[1];
  if (feedbackMessage.length) {
    bot.sendMessage(ownerChatId, '#отзывОнай: ' + feedbackMessage + ' | Пользователь: ' + USER);
    bot.sendChatAction(USER, 'typing');
    botan.track(message, 'Feedback placing');
    bot.sendMessage(USER, Messages.feedbackPlaced);
  }
});

module.exports = bot;
