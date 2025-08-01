# How to Add Model Names to Custom Command Descriptions

This guide explains how to display the specific model being used by a custom command directly in its description. This is helpful for quickly seeing which model a command like `/think` or `/check` will use without needing to open the configuration file.

## The Problem

When you run the `/cmd` command, you see a list of available custom commands and their descriptions. By default, the description might be generic.

**Example (Before):**
```
/think - Balanced model, excellent for most development tasks...
```

## The Solution

You can make the model visible in the command list by editing the command's `.toml` configuration file.

1.  **Locate the command files:** Navigate to the `.gemini/commands/cmd/` directory in your project.
2.  **Edit the file:** Open the `.toml` file for the command you want to change (e.g., `think.toml`).
3.  **Update the description:** Find the `description` line and add the model name in parentheses.

**Example (After):**
```toml
# Invoked as: /think "Your prompt here"
description = "Balanced model (gemini-2.5-pro), excellent for most development tasks, code generation, and detailed analysis."
model = "gemini-2.5-pro"
prompt = "{{args}}"
```

By making this simple change, the output of `/cmd` will now be more informative:

```
/think - Balanced model (gemini-2.5-pro), excellent for most development tasks...
```

Repeat this for any other custom commands you have configured.
