# State Management Refactoring Summary

## 1. Problem Statement

The application suffered from a series of critical, recurring bugs related to state management, all stemming from the same architectural flaws. The primary symptoms were:

1.  **Profile Amnesia:** After loading a creative profile (e.g., for a comic strip), the application would "forget" the selection and throw a `[FATAL] The active profile path is not set` error when trying to generate a post.
2.  **Input Overwriting:** User-entered topics for posts were being discarded and reset to the default topic from `config.json` between menu interactions.
3.  **Fatal `split` Error:** When a comic strip workflow was finally triggered, the application would crash with a `TypeError: Cannot read properties of undefined (reading 'split')` in the `comic-composer.js` module. This indicated that the selected comic layout (e.g., "2x2") was not being passed to the final composition function.

These issues made the application unusable and the debugging process frustrating due to cascading failures.

## 2. Root Cause: Flawed State Architecture

The core of the problem was a complete lack of a single source of truth for the application's state.

-   **`config` vs. `state`:** A single `config` object, loaded from `config.json`, was being used for two conflicting purposes: as a source of static, unchanging configuration, and as a temporary, in-memory store for the user's choices during a session (the "session state").
-   **Rogue File Reads:** Critical modules (especially `workflows.js`) were ignoring the in-memory object and repeatedly re-reading the original `config.json` from the disk. This action immediately erased any in-memory changes, such as loading a new profile.
-   **Unpredictable UI State:** The UI layer (`menu.js`) had complex logic that tried to manage its own state, often resetting user input or failing to update correctly when the underlying session state changed.

## 3. Summary of Remediation Steps

To fix this, the entire state management architecture was refactored.

1.  **Introduced `sessionState`:** The `config` object was renamed to `sessionState` throughout the application (`app.js`, `menu-manager.js`, `menu.js`, `workflows.js`, etc.). This makes its purpose clear: it is the single, authoritative object for all session-related data.
2.  **Centralized State Control:** The `menuManager` was made the sole controller of the `sessionState` object. It now passes this object down to all sub-menus and actions, and it is responsible for receiving and applying any updates returned by those actions.
3.  **Eliminated Rogue File Reads:** All `fs.readFileSync` calls for `config.json` were removed from the workflow and provider modules. These modules now receive the `sessionState` object as a parameter and rely on it exclusively.
4.  **Unified Data Loading:** Supporting data (like `character_library.json`) is now loaded only *once* at startup in `app.js` and attached to the `sessionState` object.
5.  **Corrected Provider Initialization:** The image and text generation "factories" (`image-generators/index.js`, `text-generators/index.js`) were fixed to receive the full `sessionState` object, ensuring providers are initialized with the correct API keys and model configurations.
6.  **Simplified UI Logic:** The logic within `generatePostMenu` in `menu.js` was refactored to prevent it from resetting user input while correctly displaying conditional UI elements (like the comic layout selector).

## 4. The Lingering Failure (The `split` Error)

Despite the comprehensive architectural changes, the `TypeError: ... (reading 'split')` error persists. This proves that a subtle but critical flaw still exists in the logic that manages the `postDetails` object within the `generatePostMenu` closure in `src/lib/ui/menu.js`.

The current implementation, while improved, still contains logic that implicitly mutates the `comicLayout` property based on menu re-renders, rather than solely on direct user action. This creates an edge case where the layout is reset to `null` immediately before the final generation step, causing the crash. The next action must be to correct this final piece of flawed UI logic.
