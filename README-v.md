# Simple File Versioning Utility (`v.js`)

`v.js` is a lightweight, standalone command-line utility for creating and restoring simple, timestamped backups of any file. It's designed for small projects and quick experiments where using a full version control system like Git feels like overkill.

## Features

-   **Simple Commands:** Easy-to-remember commands for saving, restoring, and listing versions.
-   **Timestamped Backups:** Creates backups with a `YYYYMMDD_HHMMSS` timestamp, so you never overwrite a previous save.
-   **File Agnostic:** Works with any file (`.js`, `.txt`, `.json`, etc.).
-   **Organized:** All backups are stored neatly in a `backups/` directory, which is created automatically.

## Prerequisites

-   [Node.js](https://nodejs.org/)

## Usage

The script is run from your terminal using Node.js and follows a simple `node v.js [command] [filename]` structure.

### Commands

#### 1. Save a Version

To save the current state of a file, use the `save` command.

```bash
node v.js save <filename>
```

**Example:**
This will create a copy of `runAutomation.js` in the `backups/` folder with a name like `runAutomation_20250709_110000.js`.

```bash
node v.js save runAutomation.js
```

#### 2. Restore the Last Version

To revert a file to its most recently saved version, use the `restore` command.

```bash
node v.js restore <filename>
```

**Example:**
This finds the newest backup of `runAutomation.js` in the `backups/` folder and uses it to overwrite the current `runAutomation.js`.

```bash
node v.js restore runAutomation.js
```

#### 3. List All Versions

To see all available backups for a specific file, use the `list` command.

```bash
node v.js list <filename>
```

**Example:**
This will print a list of all saved backups for `runAutomation.js`.

```bash
node v.js list runAutomation.js
```

## How It Works

-   **Saving:** When you save, the script copies the target file to the `backups/` directory, appending a timestamp to the original filename.
-   **Restoring:** The script scans the `backups/` directory for all files matching the target filename, identifies the most recent one by its timestamp, and copies it back to the original file's location.
