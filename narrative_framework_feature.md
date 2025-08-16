# Feature Plan: Separate Narrative Frameworks from Prompt Profiles

## Problem

Currently, the `prompt_profiles` directory mixes concerns of visual style (e.g., `vintage_comic`), workflow (e.g., `character-driven`), and narrative strategy. This makes the system inflexible and difficult to manage. To combine a different narrative with a style, a whole new profile file is required.

## Proposed Solution

To improve modularity and flexibility, we will separate the concept of a "narrative framework" from the "prompt profile".

1.  **`prompt_profiles`:** This directory will be dedicated solely to **visual style** and **workflow instructions**.
2.  **`narrative_frameworks`:** A new directory will be created to hold different **storytelling strategies**, based on the `social_post_frameworks_cheatsheet.md`.

This separation will allow users to mix and match any visual style with any narrative framework, dramatically increasing the creative possibilities.

## Implementation Steps

1.  **Create a new directory:**
    - Create a directory named `narrative_frameworks` at the root of the project.

2.  **Populate the new directory:**
    - Create individual JSON files for each framework in the cheatsheet (e.g., `myth_buster.json`, `problem_solution.json`).
    - Each file will contain the name, description, and a template for how the AI should structure the post and comic panels.
    - Example `narrative_frameworks/myth_buster.json`:
      ```json
      {
        "name": "Myth -> Truth -> Action",
        "description": "Debunks a common myth, presents a counterintuitive truth, and provides a clear action.",
        "template": "Structure the post summary using this format:\n- Myth: \"{popular belief}.\"
- Truth: \"{what actually matters}.\"
- Action: \"{do this instead}.\"

The comic panels should visually tell the story of this myth being busted."
      }
      ```

3.  **Update Application Logic:**
    - Modify the main application menu (`src/lib/ui/menu.js` is a likely candidate).
    - After the user selects a topic, add a new prompt: `"What narrative framework would you like to use?"` which lists the files from the `narrative_frameworks` directory.
    - The core generation logic (`src/lib/workflows.js`) will need to be updated to:
        - Load the selected `prompt_profile`.
        - Load the selected `narrative_framework`.
        - Combine the instructions from both files to create the final, comprehensive prompt for the text generation AI.

