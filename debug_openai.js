const OpenAI = require('openai');
console.log('OpenAI Path:', require.resolve('openai'));
try {
    const packageJson = require('openai/package.json');
    console.log('OpenAI Version:', packageJson.version);
} catch (e) { console.log('No package.json'); }

const openai = new OpenAI({ apiKey: 'mock' });
console.log('beta keys:', Object.keys(openai.beta));
console.log('vectorStores type:', typeof openai.beta.vectorStores);
