# Automation App Menu Structure (Detailed)

This document outlines the complete interactive menu and workflow structure of the social media automation application.

## Main Menu

The main menu is the top-level entry point. The prompt always displays the currently active platform (e.g., X or LinkedIn).

-   **`Switch Platform`**
    -   Asks you to choose a new platform from a list (`X`, `LinkedIn`).

-   **`Manage Creative Profiles`**
    -   **`Load a Profile`**
        -   `->` Shows a list of available `.json` profiles to load.
    -   **`Create a New Profile`**
        -   `->` Prompts for: *Filename for the new profile*.
        -   `->` Prompts for: *New image style*.
        -   `->` Asks: *Choose the profile type* (`Standard Cartoon` or `Virtual Influencer`).
        -   `->` **IF** `Virtual Influencer` is chosen:
            -   `->` Prompts for: *Detailed description of your virtual influencer*.
        -   `->` Asks: *Would you like to load this new profile now?* (Yes/No).
    -   **`Delete a Profile`**
        -   `->` Shows a list of available `.json` profiles to delete.
        -   `->` Asks for confirmation: *Are you sure you want to permanently delete?* (Yes/No).
    -   **`Back to Main Menu`**

-   **`Start the scheduler for [Platform]`**
    -   (No further prompts. Starts a background process.)

-   **`Stop the scheduler`**
    -   (No further prompts. Stops the background process.)

-   **`Process scheduled posts for [Platform] manually`**
    -   (No further prompts. Runs the posting cycle for any due items.)

-   **`Post a new cartoon to [Platform] immediately`**
    -   `->` Prompts for: *Topic for the new cartoon* (opens in a text editor).
    -   `->` **IF** `Virtual Influencer` profile is active:
        -   `->` Asks: *Do you want to include a speech bubble?* (Yes/No).
        -   `->` **IF** `Yes`:
            -   `->` Prompts for: *Dialogue for the speech bubble* (opens in a text editor).
        -   `->` Asks: *Choose the framing for the virtual influencer* (shows list from `config.json`).
        -   `->` **IF** `Custom...` is chosen:
            -   `->` Prompts for: *Custom framing instructions* (opens in a text editor).
    -   `->` **IF** `Standard Cartoon` profile is active:
        -   `->` Asks: *Do you want to include a speech bubble in this cartoon?* (Yes/No).
    -   `->` *[Script generates content with Gemini API]*
    -   `->` Asks: *Generated news summary...* (`Approve`, `Edit`, or `Cancel`).
    -   `->` **IF** `Edit`:
        -   `->` Opens `summary_for_editing.txt` and waits for user to save and close.
    -   `->` **IF** `Virtual Influencer` profile is active:
        -   `->` Asks: *Generated background prompt...* (`Approve`, `Edit`, or `Cancel`).
        -   `->` **IF** `Edit`:
            -   `->` Opens `prompt_for_editing.txt` and waits for user to save and close.
    -   `->` **IF** `Standard Cartoon` profile is active:
        -   `->` Asks: *Generated image prompt...* (`Approve`, `Edit`, or `Cancel`).
        -   `->` **IF** `Edit`:
            -   `->` Opens `prompt_for_editing.txt` and waits for user to save and close.
    -   `->` *[Script generates image and posts to social media]*

-   **`Reload the configuration file (config.json)`**
    -   (No further prompts. Reloads the config.)

-   **`Quit`**
    -   (No further prompts. Exits the application.)