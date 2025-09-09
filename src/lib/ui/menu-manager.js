import { select, Separator } from '@inquirer/prompts';
import chalk from 'chalk';

export async function menuManager(sessionState, menu) {
    const menuStack = [menu];
    let keepGoing = true;

    while (keepGoing && menuStack.length > 0) {
        let currentMenu = menuStack[menuStack.length - 1];
        
        while (typeof currentMenu === 'function') {
            currentMenu = currentMenu();
        }

        // Normalize choices: evaluate dynamic labels if provided as functions
        const choices = currentMenu.choices.map((c) => {
            // Preserve separators as-is
            if (c instanceof Separator) return c;
            const name = typeof c.name === 'function' ? c.name() : c.name;
            return { ...c, name };
        });

        if (menuStack.length > 1) {
            choices.push(new Separator());
            choices.push({ name: 'Back', value: 'back' });
        }
        
        choices.push(new Separator());
        choices.push({ name: 'Quit', value: 'quit' });

        console.log(chalk.yellow(`
--- ${currentMenu.title} ---`));
        const action = await select({ message: currentMenu.message, choices });

        if (action === 'back') {
            menuStack.pop();
        } else if (action === 'quit') {
            keepGoing = false;
        } else {
            const selectedChoice = currentMenu.choices.find(c => c.value === action);
            
            if (selectedChoice) {
                // Step 1: Execute the action if it exists.
                if (selectedChoice.action) {
                    await selectedChoice.action();
                }
                // Step 2: Push the submenu if it exists.
                if (selectedChoice.submenu) {
                    menuStack.push(selectedChoice.submenu);
                }
                // Step 3: Pop after action if specified (and no submenu).
                if (selectedChoice.popAfterAction && !selectedChoice.submenu) {
                    menuStack.pop();
                }
            }
        }
    }
    console.log("[APP-INFO] Shutting down.");
}
