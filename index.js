const axios = require('axios');
const { ethers } = require('ethers');
const readline = require('readline');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  magenta: "\x1b[35m",
};

const logger = {
  info: (msg) => console.log(`${colors.white}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[→] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`--------------------------------------`);
    console.log(` PushChain Auto - Airdrop Insiders`);
    console.log(`--------------------------------------${colors.reset}`);
  }
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0"
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

let proxyList = [];

function loadProxies() {
  try {
    if (fs.existsSync('proxies.txt')) {
      const data = fs.readFileSync('proxies.txt', 'utf8');
      proxyList = data
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          if (line.startsWith('http://') || line.startsWith('https://')) {
            return line;
          }
          return `http://${line}`;
        });

      if (proxyList.length > 0) {
        logger.info(`Loaded ${proxyList.length} proxies from proxies.txt`);
      } else {
        logger.warn('proxies.txt found but empty. Running in direct mode.');
      }
    } else {
      logger.warn('proxies.txt not found. Running in direct mode.');
    }
  } catch (error) {
    logger.error(`Error loading proxies: ${error.message}`);
    logger.warn('Running in direct mode.');
  }
}

function getProxyAgent(index) {
  if (proxyList.length === 0) {
    return null;
  }
  const proxyString = proxyList[index % proxyList.length];
  logger.info(`Using proxy: ${proxyString.replace(/:\/\/(.*)@/, '://****@')}`);
  return new HttpsProxyAgent(proxyString);
}

const RPC_URL = 'https://evm.donut.rpc.push.org/';
const PINATA_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

const TOKEN_LAUNCH_CONTRACT = '0xFB07792D0F71C7e385aC220bEaeF0cbF187233A0';
const SIMULATE_TX_ADDRESS = '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108';

const DOMAIN_REGISTRAR_CONTRACT = '0x84c48f4995Db90e9feD4c46d27e6468A5172Fc49';

const provider = new ethers.JsonRpcProvider(RPC_URL);

const abiCoder = new ethers.AbiCoder();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function simulateTransaction(wallet, count) {
  try {
    logger.loading(`Simulating ${count} transaction(s)...`);

    const results = [];
    for (let i = 0; i < count; i++) {
      const tx = {
        to: SIMULATE_TX_ADDRESS,
        value: ethers.parseEther('0.001'),
        data: '0x'
      };

      const txResponse = await wallet.sendTransaction(tx);
      logger.success(`Tx ${i + 1}/${count} sent: ${txResponse.hash}`);

      await txResponse.wait();
      logger.success(`Tx ${i + 1}/${count} confirmed`);

      results.push(txResponse.hash);

      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return results;
  } catch (error) {
    logger.error(`Simulate transaction error: ${error.message}`);
    return [];
  }
}

async function uploadToPinata(metadata, agent) {
  try {
    const response = await axios.post(PINATA_URL, {
      pinataContent: metadata,
      pinataMetadata: {
        name: `${metadata.name}-metadata`,
        keyvalues: {
          tokenName: metadata.name,
          platform: 'TokenLaunch',
          network: 'PushChain',
          timestamp: new Date().toISOString()
        }
      }
    }, {
      headers: {
        'content-type': 'application/json',
        'pinata_api_key': '4d6d1b9e4e595455bc33',
        'pinata_secret_api_key': '22b97a9fd13a421aeea516665328df5d3c9335d9194ab3dff9f80347a571d520',
       'User-Agent': getRandomUserAgent()
      },
      httpsAgent: agent,
      httpAgent: agent
    });

    return response.data.IpfsHash;
  } catch (error) {
    logger.error(`Pinata upload error: ${error.message}`);
    return null;
  }
}

async function launchToken(wallet, tokenData, agent) {
  try {
    logger.loading(`Launching token ${tokenData.name}...`);

    const metadata = {
      name: tokenData.name,
      description: tokenData.description,
      image: tokenData.image || '',
      external_url: tokenData.external_url || '',
      social_links: {
        website: tokenData.website || '',
        twitter: tokenData.twitter || '',
        telegram: tokenData.telegram || ''
      },
      attributes: [
        { trait_type: 'Platform', value: 'TokenLaunch' },
        { trait_type: 'Network', value: 'Push Chain' },
        { trait_type: 'Created', value: new Date().toISOString() }
      ]
    };

    const ipfsHash = await uploadToPinata(metadata, agent);
    if (!ipfsHash) {
      throw new Error('Failed to upload metadata to IPFS');
    }

    logger.success(`Metadata uploaded to IPFS: ${ipfsHash}`);

    const iface = new ethers.Interface([
      'function createToken(tuple(string name, string symbol, uint256 totalSupply, string uri, uint256 maxBuyPercentage, address creator) params)'
    ]);

    const params = {
      name: tokenData.name,
      symbol: tokenData.symbol,
      totalSupply: ethers.parseEther(tokenData.supply),
      uri: `ipfs://${ipfsHash}`,
      maxBuyPercentage: tokenData.maxBuyPercentage || 5000,
      creator: wallet.address
    };

    const data = iface.encodeFunctionData('createToken', [params]);

    const tx = {
      to: TOKEN_LAUNCH_CONTRACT,
      value: ethers.parseEther('0.01'),
      data: data
    };

    const txResponse = await wallet.sendTransaction(tx);
    logger.success(`Token launch transaction sent: ${txResponse.hash}`);

    const receipt = await txResponse.wait();
    logger.success('Token launched successfully!');
    logger.info(`Transaction Hash: ${receipt.hash}`);

    return receipt.hash;
  } catch (error) {
    logger.error(`Launch token error: ${error.message}`);
    return null;
  }
}

function loadWalletsFromEnv() {
  const wallets = [];
  let index = 1;

  while (process.env[`PRIVATE_KEY_${index}`]) {
    const privateKey = process.env[`PRIVATE_KEY_${index}`];
    const wallet = new ethers.Wallet(privateKey, provider);
    wallets.push(wallet);
    index++;
  }

  return wallets;
}

async function handleRegisterDomain() {
  const wallets = loadWalletsFromEnv();
  if (wallets.length === 0) {
    logger.error('No wallets found in .env file');
    return;
  }

  console.log(`\n${colors.cyan}Available wallets:${colors.reset}`);
  wallets.forEach((wallet, i) => {
    console.log(`${colors.white}${i + 1}. ${wallet.address}${colors.reset}`);
  });

  const walletIndex = await question('Select wallet number for domain registration: ');
  const index = parseInt(walletIndex) - 1;

  if (isNaN(index) || index < 0 || index >= wallets.length) {
    logger.error('Invalid wallet selection');
    return;
  }

  let domainName = await question('Enter domain (e.g., vikitoshi.push): ');
  domainName = (domainName || '').trim().toLowerCase();

  if (!domainName) {
    logger.error('Domain cannot be empty');
    return;
  }

  if (!domainName.includes('.')) {
    domainName = `${domainName}.push`;
    logger.info(`No TLD detected, using: ${domainName}`);
  }

  const chainId = 42101;
  const metadata = {
    registeredBy: 'PushChain Auto Bot',
    timestamp: Date.now()
  };
  const metadataJson = JSON.stringify(metadata);

  const selector = '0xe9f36aef';
  const encodedArgs = abiCoder.encode(
    ['string', 'uint256', 'address', 'string'],
    [domainName, chainId, wallets[index].address, metadataJson]
  );
  const data = selector + encodedArgs.slice(2);

  logger.loading(`Registering domain "${domainName}" for ${wallets[index].address} ...`);

  try {
    const tx = {
      to: DOMAIN_REGISTRAR_CONTRACT,
      value: ethers.parseEther('0.01'),
      data
    };

    const txResponse = await wallets[index].sendTransaction(tx);
    logger.success(`Domain tx sent: ${txResponse.hash}`);

    const receipt = await txResponse.wait();
    if (receipt.status === 1) {
      logger.success(`Domain "${domainName}" registered successfully!`);
    } else {
      logger.error('Domain registration tx reverted');
    }
  } catch (err) {
    logger.error(`Domain registration error: ${err.message}`);
  }
}

async function handleSimulateTransactions() {
  const wallets = loadWalletsFromEnv();
  if (wallets.length === 0) {
    logger.error('No wallets found in .env file');
    return;
  }

  logger.info(`Found ${wallets.length} wallet(s) in .env`);
  const count = await question('How many transactions to simulate per wallet? ');
  const txCount = parseInt(count);

  if (isNaN(txCount) || txCount <= 0) {
    logger.error('Invalid transaction count');
    return;
  }

  for (let i = 0; i < wallets.length; i++) {
    console.log(`\n${colors.cyan}[Wallet ${i + 1}/${wallets.length}] ${wallets[i].address}${colors.reset}`);
    await simulateTransaction(wallets[i], txCount);
  }
}

async function handleLaunchTokenMenu() {
  const wallets = loadWalletsFromEnv();
  if (wallets.length === 0) {
    logger.error('No wallets found in .env file');
    return;
  }

  console.log(`\n${colors.cyan}Available wallets:${colors.reset}`);
  wallets.forEach((wallet, i) => {
    console.log(`${colors.white}${i + 1}. ${wallet.address}${colors.reset}`);
  });

  const walletIndex = await question('Select wallet number: ');
  const index = parseInt(walletIndex) - 1;

  if (isNaN(index) || index < 0 || index >= wallets.length) {
    logger.error('Invalid wallet selection');
    return;
  }

  console.log(`\n${colors.yellow}Enter token details:${colors.reset}`);
  const name = await question('Token Name: ');
  const symbol = await question('Token Symbol: ');
  const supply = await question('Total Supply (e.g., 10000000): ');
  const description = await question('Description: ');
  const image = await question('Image URL (optional): ');
   const website = await question('Website (optional): ');
  const twitter = await question('Twitter (optional): ');
  const telegram = await question('Telegram (optional): ');

  const tokenData = {
    name,
    symbol,
    supply,
    description,
    image,
    website,
    twitter,
    telegram
  };

  const agent = getProxyAgent(index);
  await launchToken(wallets[index], tokenData, agent);
}

async function mainMenu() {
  console.log();
  console.log(`${colors.white}--- Choose Your Menu ---${colors.reset}`);
  console.log(`1. Simulate Transactions`);
  console.log(`2. Launch Token`);
  console.log(`3. Register Domain`);
  console.log(`0. Exit${colors.reset}`);

  const choice = await question('Select option: ');

  switch (choice) {
    case '1':
      await handleSimulateTransactions();
      break;
    case '2':
      await handleLaunchTokenMenu();
      break;
    case '3':
      await handleRegisterDomain();
      break;
    case '0':
      logger.info('Goodbye!');
      rl.close();
      process.exit(0);
    default:
      logger.error('Invalid option');
  }

  await mainMenu();
}

async function start() {
  logger.banner();

  loadProxies();

  const envWallets = loadWalletsFromEnv();
  console.log(`${colors.green}[✓] Found ${envWallets.length} wallet(s) in .env${colors.reset}`);

  mainMenu();
}

start();