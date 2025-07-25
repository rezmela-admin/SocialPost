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

## Standard Protocol for Code Modification

To ensure all code modifications are reliable, token-efficient, and prevent errors, the following patch-based workflow is the **single, authoritative standard**.

1.  **Generate a Unified Diff:** Instead of modifying a file directly, first generate a unified diff of the intended changes. This can be done by creating a temporary file with the changes and using the `diff` utility.
2.  **Create a Patch File:** Save the generated diff content into a file with a `.patch` extension (e.g., `feature-xyz.patch`). The patch file itself serves as the "before and after" view of the change.
3.  **Apply the Patch:** Use the `git apply` command to apply the patch to the target file (e.g., `git apply feature-xyz.patch`). This is the required method as it is integrated with Git and provides superior error checking.
4.  **Verify Changes:** After applying the patch, use `read_file` to confirm the changes have been applied correctly.
5.  **Cleanup:** Once the patch is successfully applied and verified, delete the `.patch` file and any temporary files used to create it.

## Clarification on File I/O Tool Usage

To support the standard protocol, the file system tools must be used as follows:

*   **`git apply`:** The **only** approved method for *modifying* existing code files.
*   **`write_file`:** To be used **only** for:
    *   Creating entirely new files (e.g., a new script, a new profile).
    *   Overwriting non-code files where a patch is not applicable (e.g., logs, reports, or this `GEMINI.md` file).
*   **`replace`:** Deprecated for code modifications. Its use is highly discouraged and should be limited to exceptional cases, such as single-line, non-code text changes where a patch would be excessive.

## Supporting Protocols

*   **Verification Protocol:**
    *   **1. Mandatory Read-After-Write Verification:** After every file modification (`git apply`, `write_file`), I am required to immediately use `read_file` on the same file to verify the content matches the intended change.
    *   **2. The User Verification Gate:** I must never declare a bug "fixed" or a task "complete" based solely on a successful tool execution. The final step is to explicitly ask you to run the application and verify the fix.
*   **Refactoring Protocol:**
    *   **1. Trace Dependencies First:** Before proposing a code change, explicitly map out and state the functions that call the target code and the functions that the target code calls.
    *   **2. One Logical Change at a Time:** Do not bundle multiple, independent refactoring steps into a single operation. Each patch should be atomic and verifiable.
