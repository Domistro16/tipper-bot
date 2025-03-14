import "dotenv/config";
import abi from "./abi.js";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, time } from 'discord.js';
import { ethers, formatUnits, parseUnits } from 'ethers';
import { mnemonicToEntropy } from "bip39";
import axios from "axios"

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;      // Your bot’s application ID
const GUILD_ID = process.env.GUILD_ID;        // For testing; use a specific guild ID                   
const BSC_RPC_URL = process.env.BSC_RPC_URL;
const MEMECOIN_ADDRESS = process.env.MEMECOIN_ADDRESS;
const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS) ?? 18;
const BOT_ADDRESS = process.env.BOT_ADDRESS


// Set up ethers provider for BSC
const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);



const tokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, provider);

// Bot wallet (for droptip escrow)
const botWallet = new ethers.Wallet(BOT_PRIVATE_KEY, provider);



// In-memory stores
const userWallets = new Map();  // Map Discord user ID => ethers wallet
const droptips = new Map();     // Map droptip ID => droptip object
let nextDroptipId = 1;

// Helper: get or create a user's wallet
async function getUserWallet(userId) {
  console.log(`Fetching wallet for user ID: ${userId}`);

  try {
    const res = await axios.get(`http://tipper-server-production.up.railway.app/api/wallets/${userId}`);
    console.log(`Wallet retrieved from API: ${JSON.stringify(res.data)}`);
    return res.data.wallet; // Assuming API returns { wallet: { address: "0x..." } }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log("Wallet not found, creating a new one...");
      
      const wallet = ethers.Wallet.createRandom().connect(provider);
      try {
        console.log('trying...');
        await axios.post(`http://tipper-server-production.up.railway.app/api/wallets/newWallet`, {
          userId,
          wallet: {privateKey: wallet.privateKey, walletobj: wallet} // Ensure valid structure
        });
        console.log(`New wallet created and stored: ${wallet.address}`);
        return wallet;
      } catch (saveErr) {
        console.error(`Error saving new wallet: ${saveErr.message}`);
        return null; // Prevents further errors
      }
    } else {
      console.error(`Unexpected error fetching wallet: ${err.message}`);
      return null;
    }
  }
}
async function getDroptip(droptipId) {
  console.log(`Fetching droptip for Droptip ID: ${droptipId}`);

  try {
    const res = await axios.get(`http://tipper-server-production.up.railway.app/api/droptips/${droptipId}`);
    console.log(`Droptip retrieved from API: ${JSON.stringify(res.data)}`);
    return res.data.droptip; // Assuming API returns { wallet: { address: "0x..." } }
  }catch(error){
    console.log(error);
  }
}

async function getKey(UserId) {
  console.log(`Fetching key for ID: ${UserId}`);

  try {
    const res = await axios.get(`http://tipper-server-production.up.railway.app/api/wallets/privateKey/${UserId}`);
    console.log(`private key retrieved from API: ${JSON.stringify(res.data)}`);
    return res.data.wallet; // Assuming API returns { wallet: { address: "0x..." } }
  }catch(error){
    console.log(error);
  }
}

async function setDroptip(droptipId, droptip) {
  console.log(`Updating droptip for Droptip ID: ${droptipId}`);
  // Convert BigInt values to strings if needed
  const formattedDroptip = JSON.parse(JSON.stringify({
    droptipId,
    droptip 
  }, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));
  try {
    const res = await axios.post(`http://tipper-server-production.up.railway.app/api/droptips/updateDroptip`, formattedDroptip);
    console.log(`Droptip updated from API: ${JSON.stringify(res.data)}`);
    return res; // Assuming API returns { wallet: { address: "0x..." } }
  }catch(error){
    console.log(error);
  }
}

async function newDroptip(droptipId, droptip) {
  console.log(`Creating droptip for Droptip ID: ${droptipId}`);

  // Convert BigInt values to strings if needed
  const formattedDroptip = JSON.parse(JSON.stringify({ 
    droptipId, 
    droptip 
  }, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));

  try {
    const res = await axios.post(`http://tipper-server-production.up.railway.app/api/droptips/newDroptip/`, formattedDroptip);
    return res; // Assuming API returns { wallet: { address: "0x..." } }
  } catch (error) {
    console.log(error);
  }
}



function waitMinutes(minutes) {
  return new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));
}
async function setExpiryTimer(minutes, droptipId) {
  console.log(`Timer started for ${minutes} minutes for Droptip ID: ${droptipId}`);
  await waitMinutes(minutes);
  
  const droptip = await getDroptip(droptipId);
  if (!droptip) return;

  const attendees = droptip.attendees;
  const signer = new ethers.Wallet(BOT_PRIVATE_KEY, provider);
  const botTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);

  if (attendees.length > 0) {
    const bigAmount = BigInt(droptip.amount);
    const amountPerAttendee = bigAmount / BigInt(attendees.length);


// When transferring, convert it to a string:
for (const attendee of attendees) {
    try {
        const tx = await botTokenContract.transfer(attendee, amountPerAttendee.toString());
        await tx.wait();
        console.log(`Sent ${amountPerAttendee.toString()} tokens to ${attendee}`);
    } catch (err) {
        console.error(`Failed to send tokens to ${attendee}:`, err);
    }
}


      droptip.claimed = true;
      droptip.available = false;
  } else {
      droptip.claimed = false;
      droptip.available = false;
      const senderWallet = await getUserWallet(droptip.senderId);

      const senderAddress = senderWallet.address;
      const tx = await botTokenContract.transfer(senderAddress, droptip.amount)
      await tx.wait();
      console.log(`Droptip ID ${droptipId} expired with no claims.`);
  }

  await setDroptip(droptipId, droptip);
}


/* ===============================
   SLASH COMMAND REGISTRATION
   =============================== */

const commands = [
  new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Display your wallet address and token balance.'),
  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Get your deposit address to receive tokens.'),
  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw tokens to an external address.')
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Amount of tokens to withdraw')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('destination')
        .setDescription('Destination wallet address')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('tip')
    .setDescription('Tip another user tokens.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to tip')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Amount of tokens to tip')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('droptip')
    .setDescription('Drop a tip that anyone can claim.')
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Amount of tokens to droptip')
        .setRequired(true))
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Time for droptip to expire')
                .setRequired(true)
                .addChoices(
                    { name: '1 minute', value: '1' },
                    { name: '3 minutes', value: '3' },
                    { name: '5 minutes', value: '5' },
                    { name: '10 minutes', value: '10' },
                    { name: '15 minutes', value: '15' },
                    { name: '30 minutes', value: '30' }
                )
        )        
].map(command => command.toJSON());

// Register slash commands for a specific guild (for testing)
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

/* ===============================
   DISCORD CLIENT SETUP
   =============================== */

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Listen for interactions (commands & buttons)
client.on('interactionCreate', async (interaction) => {
  // Slash Commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    // /wallet - show wallet address and token balance
    if (commandName === 'wallet') {
      console.log(`Executing /wallet command for user: ${interaction.user.id}`);
    
      await interaction.reply({content: `Checking...`, ephemeral: true});
    
      try {
        const wallet = await getUserWallet(interaction.user.id);
        console.log(`Wallet Address Retrieved: ${wallet.address}`);
    
        let balance;
        try {
          balance = await tokenContract.balanceOf(wallet.address);
          console.log(`Wallet Balance Retrieved: ${balance.toString()}`);
        } catch (err) {
          console.error(`Error fetching token balance: ${err.message}`);
          balance = ethers.BigNumber.from(0);
        }
    
        const formatted = formatUnits(balance, TOKEN_DECIMALS);
        await interaction.editReply({
          content: `Your wallet address is: \`${wallet.address}\`\nToken Balance: ${formatted}`,
          ephemeral: true
        });
    
        console.log("Wallet command executed successfully");
      } catch (err) {
        console.error(`Error in /wallet command: ${err.message}`);
        await interaction.editReply({ content: "An error occurred while fetching your wallet.", ephemeral: true });
      }
    }
    
    // /deposit - show wallet deposit instructions
    else if (commandName === 'deposit') {
      const wallet = await getUserWallet(interaction.user.id);
      await interaction.reply({content: `Checking...`, ephemeral: true});
      await interaction.editReply({content: `To deposit tokens, send them to your wallet address:\n**${wallet.address}**`, ephemeral: true});
    }
    // /withdraw <amount> <destination>
    else if (commandName === 'withdraw') {
      const amount = interaction.options.getString('amount');
      const destination = interaction.options.getString('destination');
      const key = await getKey(interaction.user.id);
      const signer = new ethers.Wallet(key, provider);
      const userTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);
      await interaction.deferReply();
      try {
        const tx = await userTokenContract.transfer(destination, parseUnits(amount, TOKEN_DECIMALS));
        await tx.wait();
        await interaction.editReply({content: `Withdrawal successful!\nSent ${amount} tokens to \`${destination}\`\nTransaction Hash: \`${tx.hash}\``, ephemeral: true});
      } catch (err) {
        console.error(err);
        await interaction.editReply({content: `Withdrawal failed: ${err.message}`, ephemeral: true});
      }
    }
    // /tip <user> <amount>
    else if (commandName === 'tip') {
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getString('amount');
      const fee = 0.01 * parseFloat(amount);
      const targetId = targetUser.id;
      await interaction.reply({content: 'Tipping...', ephemeral: true});
      if (targetId === interaction.user.id) {
        return interaction.editReply({content: "You cannot tip yourself.", ephemeral: true});
      }
      const senderWallet = await getUserWallet(interaction.user.id);
      const senderKey = await getKey(interaction.user.id);
      const recipientWallet = await getUserWallet(targetId);
      const signer = new ethers.Wallet(senderKey, provider);
      const senderTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);
      try {
        const tx = await senderTokenContract.transfer(recipientWallet.address, parseUnits(amount.toString(), TOKEN_DECIMALS));
        const ftx = await senderTokenContract.transfer(botWallet.address, parseUnits(fee.toString(), TOKEN_DECIMALS));
        await tx.wait();
        await ftx.wait();
        await interaction.editReply({content: `You tipped ${amount} tokens to <@${targetId}>!\nTransaction Hash: \`${tx.hash}\``, ephemeral: true});
      } catch (err) {
        console.error(err);
        await interaction.editReply({content: `Tip failed: ${err.message}`, ephemeral: true});
      }
    }
    // /droptip <amount>
    else if (commandName === 'droptip') {
      const amount = interaction.options.getString('amount');
      let time = interaction.options.getString('time').split('mn')[0];
  
      let date = new Date();
      date.setMinutes(date.getMinutes() + parseInt(time));
      const expires = date.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' });
  
      await interaction.reply('Dropping a droptip...');
  
      try {
          const droptipId = nextDroptipId++;
          const fee = 0.01 * parseFloat(amount);
          const totalAmount = parseFloat(amount) + fee;
  
          const senderWallet = await getUserWallet(interaction.user.id);
          const senderKey = await getKey(interaction.user.id);
          const signer = new ethers.Wallet(senderKey, provider);
          const senderTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);
  
          // Transfer total amount (including fee) to botWallet for escrow
          const escrowTx = await senderTokenContract.transfer(botWallet.address, parseUnits(totalAmount.toString(), TOKEN_DECIMALS));
          await escrowTx.wait();
  
          const droptip = {
              id: droptipId,
              senderId: interaction.user.id,
              amount: parseUnits(amount, TOKEN_DECIMALS),
              claimed: false,
              time: `${time} minutes`,
              attendees: [],
              available: true,
              expires
          };
  
          await newDroptip(droptipId.toString(), droptip);
  
          const claimButton = new ButtonBuilder()
            .setCustomId(`claim_droptip_${droptipId}`) // Correct
            .setLabel("Collect")
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(claimButton);
  
          await interaction.editReply({ 
              content: `Droptip of ${amount} tokens dropped!\nThe droptip will expire in ${time} minutes\nExpires by ${expires}`,
              components: [row]
          });
         await setExpiryTimer(time, droptipId); // Pass droptipId to correctly update the droptip on expiry

         const newDrop = await getDroptip(droptipId);
          await interaction.editReply({ 
            content: `Droptip of ${amount} tokens dropped!\nThe droptip will expired in ${time} minutes\nThis droptip has expired\nNumber of Attendees: ${newDrop.attendees.length}`,
            components: [row]
        });
      } catch (err) {
          console.error(err);
          await interaction.editReply(`Droptip failed: ${err.message}`);
      }
  }
}
 // Button Interactions (for droptip claims)
 else if (interaction.isButton()) {
  await interaction.deferReply({ ephemeral: true }); // Defer reply immediately

  const customId = interaction.customId;
  console.log(`Button interaction: ${customId}`);

  if (customId.startsWith("claim_droptip_")) {
      const droptipId = parseInt(customId.split("_")[2]);
      const droptip = await getDroptip(droptipId.toString());

      console.log('Fetched droptip');

      if (!droptip || !droptip.available) {
          return interaction.editReply({ content: "This droptip is no longer available.", ephemeral: true });
      }

      const claimerWallet = await getUserWallet(interaction.user.id);
      droptip.attendees.push(claimerWallet.address);
      await setDroptip(droptipId.toString(), droptip);

      return interaction.editReply({ content: "You have successfully participated in this droptip. Wait for the tip to be shared when the time expires.", ephemeral: true });
  }
}});
// Log in to Discord
client.login(DISCORD_TOKEN);
