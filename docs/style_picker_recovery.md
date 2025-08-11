# Updated Plan for Style Picker Implementation

**Objective:** Safely implement the graphic style picker feature.

**Status:** The application is now in a stable, working state. The previous file corruption issue in `character_library.json` has been resolved by restoring the file from Git. The `app.js` file is in its original state, without the style picker feature.

This plan outlines the necessary steps to add the feature from a clean slate.

### Step 1: Verify `graphic_styles.json`
- **Action:** Ensure the file `graphic_styles.json` exists in the project root. If it does not, create it with the following content.
- **Content:**
  ```json
  [
    {
      "name": "Vintage Comic Book",
      "prompt": "A vintage 1950s comic book panel, with bold lines, dot-matrix printing style, and a limited color palette. The scene is dramatic and expressive."
    },
    {
      "name": "Photorealistic Digital Painting",
      "prompt": "A photorealistic digital painting with a high level of detail, realistic lighting, and textures."
    },
    {
      "name": "Modern Animated Movie Still",
      "prompt": "A high-quality 3D render in the style of a modern animated feature film, with vibrant colors, soft lighting, and expressive character models."
    }
  ]
  ```

### Step 2: Add the `selectGraphicStyle` function to `app.js`
- **Action:** Copy the following `selectGraphicStyle` function and paste it into `app.js`.
- **Placement:** A good place for it is right before the `manageCreativeProfiles` function.
- **Code:**
  ```javascript
  async function selectGraphicStyle() {
      try {
          const stylesData = fs.readFileSync('./graphic_styles.json', 'utf8');
          const styles = JSON.parse(stylesData);

          const { selectedStyleName } = await inquirer.prompt([
              {
                  type: 'list',
                  name: 'selectedStyleName',
                  message: 'Choose a graphic style for the image:',
                  choices: [...styles.map(s => s.name), new inquirer.Separator(), 'Cancel'],
              },
          ]);

          if (selectedStyleName === 'Cancel') {
              return null;
          }

          return styles.find(s => s.name === selectedStyleName);

      } catch (error) {
          console.error("[APP-ERROR] Could not load or parse graphic_styles.json:", error);
          return null; // Or handle error appropriately
      }
  }
  ```

### Step 3: Integrate the function into the main menu
- **Action:** In the `main()` function, inside the `case 'Generate and Queue a New Post':` block, update all three workflows (`comicStrip`, `virtualInfluencer`, and the `else` block for standard posts) to call `selectGraphicStyle`.
- **Example Code (for the `comicStrip` workflow):**
  ```javascript
  if (comicAnswers.confirm) {
      const selectedStyle = await selectGraphicStyle();
      if (selectedStyle) {
          await generateAndQueueComicStrip({ topic: comicAnswers.topic, platforms: comicAnswers.platforms }, selectedStyle);
      } else {
          console.log('[APP-INFO] Style selection cancelled. Returning to main menu.');
      }
  }
  ```

### Step 4: Update the generation functions
- **Action:** Modify the signatures of `generateAndQueuePost`, `generateAndQueueComicStrip`, and `generateVirtualInfluencerPost` to accept a `selectedStyle` argument.
- **Action:** Inside these functions, replace any use of `config.prompt.style` or `activeProfile.style` with `selectedStyle.prompt`.
- **Example (for `generateAndQueueComicStrip`):**
  ```javascript
  // Change this:
  async function generateAndQueueComicStrip(postDetails) {
    // ...
    panelPrompt = `${activeProfile.style} ${panel.panel_description}`;
    // ...
  }

  // To this:
  async function generateAndQueueComicStrip(postDetails, selectedStyle) {
    // ...
    panelPrompt = `${selectedStyle.prompt} ${panel.panel_description}`;
    // ...
  }
  ```

### Step 5: Clean up temporary files
- **Action:** Delete the temporary test script created during our debugging session.
- **File to delete:**
  - `test_json.js`