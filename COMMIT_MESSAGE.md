feat(video): add initial video generation config and improve script execution

This commit introduces the initial configuration for video generation, refactors script execution for better safety, and updates a key dependency.

- **Configuration:** Adds a `videoGeneration` section to `config.json` to support future video providers, starting with `veo3`.
- **Refactoring:**
    - In `src/lib/workflows.js`, replaces the use of `execSync` with the safer `spawnSync` for running Python scripts, improving error handling and security.
    - In `src/lib/utils.js`, enhances the `generateImageWithRetry` function for more robust retry logic and clearer logging.
- **Dependencies:** Upgrades the `@google/genai` package from version `1.12.0` to `1.20.0`.
- **Housekeeping:**
    - Adds the new `tools/` directory.
    - Removes the old `COMMIT_MESSAGE.md` file.