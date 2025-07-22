# Refactoring Plan for `runAutomation.js`

This document outlines the plan to refactor `runAutomation.js` to reduce code duplication and improve maintainability, as discussed on 2025-07-19.

**Guiding Principle:** The user has requested that these changes be made carefully, with end-to-end testing performed after each major step to ensure no existing functionality is broken.

---

## Step 1: Consolidate User Approval Logic

*   **Task:** Merge the two nearly identical functions, `getApprovedPrompt` and `getApprovedSummary`, into a single, reusable function: `getApprovedInput(text, inputType)`.
*   **Reasoning:** The current functions are duplicates, differing only in the noun used ("prompt" vs. "summary"). A single function will make the code cleaner, reduce redundancy, and simplify future maintenance.

## Step 2: Unify API Retry Logic

*   **Task:** Combine the `openaiRequestWithRetry` and `geminiRequestWithRetry` functions into a single, more generic function, for example: `apiRequestWithRetry(apiCall, errorConditionCheck)`.
*   **Reasoning:** Both functions implement the same retry loop pattern. A single, flexible function can handle this logic for any API call by taking the specific error condition to check for as an argument. This centralizes the retry mechanism and removes duplicated code.

## Step 3: Centralize Speech Bubble Logic

*   **Task:**
    1.  Refactor the `inquirer` prompt logic that asks the user if they want a speech bubble. This is currently written out separately for the standard and virtual influencer workflows and can be consolidated.
    2.  Define the anti-cropping instruction text (`' The speech bubble must be positioned so it is fully visible and not cut off by the edges of the image.'`) as a single, shared constant and apply it from that single source.
*   **Reasoning:** This will ensure the user interaction is identical in both workflows and that the critical anti-cropping rule is applied consistently from one authoritative source, preventing the kind of bug we previously fixed.

---

This plan will be executed sequentially. After each step is completed, the application should be tested to confirm that all existing functionality remains intact before proceeding to the next step.