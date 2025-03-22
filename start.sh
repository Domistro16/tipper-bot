pm2 delete bot
pm2 delete server
pm2 start bot.js
pm2 start server/server.js
pm2 logs