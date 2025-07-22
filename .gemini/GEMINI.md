# Project: Automated Daily Cartoon Bot

This project contains an automated bot that performs the following cycle:
1.  Fetches a top news story based on a configurable topic.
2.  Uses a large language model (via the Gemini CLI) to summarize the news and generate a creative prompt for a political cartoon.
3.  Uses the OpenAI DALL-E API to generate an image based on the cartoon prompt.
4.  Posts the generated image and the news summary to a social media account (currently configured for X/Twitter).

## Core Files

*   `runAutomation.js`: The main script that orchestrates the entire automation cycle. It uses the `playwright` library for browser automation, the `openai` library for image generation, and `child_process` to call the Gemini CLI.
*   `config.json`: The configuration file for the bot. It contains settings for:
    *   `search.defaultTopic`: The default topic for news searches.
    *   `prompt.task`: The prompt template for the Gemini CLI.
    *   `prompt.style`: The style prefix for the DALL-E image generation prompt.
    *   `imageGeneration.model`: The DALL-E model to use.
    *   `imageGeneration.size`: The size of the generated image.
    *   `socialMedia.loginUrl`: The login URL for the social media site.
    *   `socialMedia.composeUrl`: The URL for the social media compose/post page.
*   `.env`: Contains the `OPENAI_API_KEY` environment variable.

## Development Notes & Conventions

*   **Configuration:** All configuration should be managed through `config.json`. Avoid hardcoding values in `runAutomation.js`.
*   **Session Management:** The script is designed to be interactive. It requires the user to log in to the social media account manually at the beginning of the session.
*   **Dependencies:** The project uses `playwright`, `openai`, and `dotenv`. Dependencies are listed in `package.json`.
*   **API Usage:**
    *   The script calls the local Gemini CLI for text generation.
    *   The script uses the OpenAI Node.js library for image generation.
*   **Error Handling:** The script includes basic error handling, but it can be improved.
*   **File Cleanup:** The script cleans up the generated image file after each post cycle.

## Gemini Collaboration Guidelines

To ensure generated code is robust, efficient, and avoids regressions, please adhere to the following principles:

*   **Analyze Before Acting:** Before writing or modifying code, thoroughly inspect the relevant files (`read_file`, `glob`) to understand existing patterns, conventions, and logic. Do not make assumptions about the codebase.
*   **Verify with Tests:** When fixing bugs or adding features, always look for and run existing tests to ensure the changes are correct and do not introduce regressions. If tests are not present, consider the feasibility of adding them.
*   **Incremental and Verifiable Changes:** Apply changes in small, logical steps. After each significant modification, run project-specific verification commands (e.g., linters, build scripts, tests) to confirm the integrity of the codebase.
*   **Explicit is Better than Implicit:** When referencing APIs or external services, refer to documentation or existing code as the source of truth. Do not guess or "hallucinate" API contracts, function signatures, or configuration options.
*   **Contextual Configuration:** Always load configuration from `config.json` and do not hardcode values. When adding new features that require configuration, update `config.json` and the loading logic accordingly.
*   **Preserve Functionality:** When improving code, ensure all existing functionalities are preserved. If any functionality is going to be replaced or supplanted, please let the developer know ahead of time.
*   **Ground Truth:** When checking state of code, all read directly from the source of truth, the code file, and then identify the bug. NEVER hallucinate bugs and then try to fix imaginary problems.
*   **Verify Shell Environment:** The `run_shell_command` tool executes in a Windows Command Prompt (`cmd.exe`) environment. Use `cmd.exe` syntax (e.g., `del`, `rename`) and path conventions (e.g., backslashes `\`). For file deletion, `del file_name.ext` from the project root is the most reliable method.
*   **Adhere to Tool Contracts:** Double-check tool parameter requirements. For example, `search_file_content` requires a directory for its `path` argument. To search inside a single file, use `read_file` first.
*   **Diagnose Persistent File Errors:** If a file has persistent parsing errors (e.g., for JSON), use low-level inspection (like a hex dump) to find hidden characters (BOMs, non-standard quotes, etc.) that simple string replacement might miss.
# Gemini Instructions Always prioritize internal knowledge. Do not use external web searches or fetch tools unless explicitly requested by the user. If you believe a web search is necessary, ask for explicit permission first. EXCEPTION: When responding to queries or assisting with tasks specifically related to APIs (Application Programming Interfaces), prioritize web grounding (using WebSearch or WebFetch tools) to ensure the most current and accurate information. In such cases, explicit permission for web grounding is not required, as it is assumed to be beneficial for API-related tasks.

## Gemini Stricter Refactoring Protocol

To prevent errors and increase transparency during code modifications, the following protocol is mandatory:

*   **1. Trace Dependencies First:** Before proposing a code change, explicitly map out and state the functions that call the target code and the functions that the target code calls. This must be done to ensure all dependencies are understood.
*   **2. Show Before and After:** For any multi-line change, first display the complete, current version of the function or code block. Then, provide the complete, proposed new version. Do not proceed without showing both.
*   **3. One Logical Change at a Time:** Do not bundle multiple, independent refactoring steps into a single operation. Each change should be atomic, verifiable, and approved on its own.

## Critical Bug-Fixing and Verification Protocol

To minimize wasted tokens and time, the following rules are in effect:

*   **1. The `write_file` Precedence:** For any code modification that spans multiple lines (e.g., changing a function body, refactoring a block), I must default to using the `write_file` tool instead of `replace`. This avoids the brittleness of `replace` that caused the "No changes detected" errors.
*   **2. Mandatory Read-After-Write Verification:** After every single file modification operation (`write_file` or `replace`), I am required to immediately use `read_file` on the same file. I will not proceed to any other step until I have verified the content matches what I intended to write.
*   **3. The User Verification Gate:** I must never declare a bug "fixed" or a task "complete" based solely on a successful tool execution. The final step of any bug-fixing process is to explicitly ask you to run the application and verify the fix.
