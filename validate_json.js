
import fs from 'fs';
import path from 'path';

/**
 * A command-line script to validate the syntax of a JSON file.
 *
 * Usage: node validate_json.js <path_to_json_file>
 */

function validateJsonFile(filePath) {
    // 1. Check if the file path is provided
    if (!filePath) {
        console.error('Error: No file path provided.');
        console.log('Usage: node validate_json.js <path_to_json_file>');
        process.exit(1);
    }

    const absolutePath = path.resolve(process.cwd(), filePath);

    // 2. Check if the file exists
    if (!fs.existsSync(absolutePath)) {
        console.error(`Error: File not found at: ${absolutePath}`);
        process.exit(1);
    }

    // 3. Read the file content
    const fileContent = fs.readFileSync(absolutePath, 'utf8');

    // 4. Attempt to parse the JSON
    try {
        JSON.parse(fileContent);
        console.log(`✅ SUCCESS: The JSON in "${filePath}" is valid.`);
    } catch (error) {
        console.error(`❌ ERROR: The JSON in "${filePath}" is invalid.`);
        console.error(`Parser Error: ${error.message}`);
        process.exit(1);
    }
}

// Get the file path from the command line arguments
const filePath = process.argv[2];
validateJsonFile(filePath);
