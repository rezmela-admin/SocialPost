
# Resolving the “Press Enter Twice” Issue in Node.js CLI Apps

When your terminal forces you to *tap **Enter** more than once* before a command truly registers, it usually means **multiple pieces of code are competing for `stdin`** or the console itself is pausing input.  
Below is a concise guide, focused on Node CLI apps that rely on **Inquirer**.

---

## Common Causes & Fixes

| Symptom | Likely Root Cause | Quick Fix |
|---------|------------------|-----------|
| Characters or whole prompts appear **duplicated**, or you must press **Enter** *twice* to confirm | You created your **own** `readline` interface **and** call `inquirer.prompt()` – both fight for TTY control | Let Inquirer own the terminal. Remove extra `readline.createInterface(...)` calls *or* call `rl.close()` before invoking Inquirer |
| Program seems to **freeze** until **Enter** is pressed (Windows CMD/PowerShell) | **Quick‑Edit Mode**: selecting text pauses the console’s input stream | Right‑click console title → **Properties** → *Options* → turn off **QuickEdit Mode** (or clear the flag via `SetConsoleMode`) |

---

## Minimal Working Example

```js
import inquirer from 'inquirer';

(async () => {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What should we do next?',
      choices: ['Build', 'Test', 'Deploy'],
    },
  ]);

  console.log(`You chose: ${action}`);
  process.exit(0);          // closes stdin cleanly
})();
```

### Why This Works
1. **Single stdin consumer** – only Inquirer handles terminal input.  
2. **Await `prompt()`** – Node’s event loop stays idle until the user answers.  
3. **Explicit `process.exit(0)`** – prevents dangling timers that keep the app “half‑alive”.

---

## Quick Checklist for Existing Projects

- **Update Inquirer**: `npm i inquirer@latest` (old 0.x versions had Win32 quirks).  
- **Search & destroy extra stdin listeners**: grep for `readline`, `keypress`, `process.stdin`.  
- **Sequence mixed libraries**: close one before starting the next.  
- **Windows users**: disable QuickEdit or document it for your users.

Follow these steps and your CLI should accept a single, decisive **Enter** every time.  
If hiccups persist, share the snippet and terminal/OS details so we can dig deeper!
