import dotenv from 'dotenv';
import fs from 'fs';
import { generateImage } from './src/lib/image-generators/gemini-provider.js';

// Read and parse config.json manually for broader Node.js compatibility
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

dotenv.config();

async function testGeminiImageGeneration() {
  const testPrompt = "A friendly cartoon robot waving hello.";
  const imageGenerationOptions = config.imageGeneration;

  console.log("Starting Gemini image generation test...");
  console.log(`Using model: ${imageGenerationOptions.model}`);
  console.log(`Prompt: "${testPrompt}"`);

  try {
    const imageB64 = await generateImage(testPrompt, imageGenerationOptions);
    
    if (imageB64) {
      const outputFilename = 'gemini_test_output.png';
      fs.writeFileSync(outputFilename, imageB64, 'base64');
      console.log(`✅ Success! Image saved to ${outputFilename}`);
    } else {
      console.error("❌ Failure: The API call succeeded but returned no image data.");
    }
  } catch (error) {
    console.error("❌ An error occurred during the Gemini image generation test:");
    if (error.response) {
        console.error("Status:", error.response.status);
        console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else {
        console.error(error);
    }
  }
}

testGeminiImageGeneration();