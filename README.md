# GGA GM Control Sheet

Version 0.3.0 · For Foundry VTT 14 and GURPS 4e Game Aid 0.18.x. Requires libWrapper.

View PCs and NPCs, make private GM checks, request player rolls, and apply group modifiers.

## Install or update

1. From Foundry's **Setup** screen, open **Add-on Modules**.
2. Paste `https://github.com/Farmeroz/gga-gm-control-sheet/releases/latest/download/module.json` into **Manifest URL** and select **Install**.
3. Install **libWrapper** through Foundry’s module browser if it is not already installed.
4. Open your GGA world and enable **libWrapper** and **GGA GM Control Sheet** under **Manage Modules**.

For a manual installation, download the versioned ZIP from [GitHub Releases](https://github.com/Farmeroz/gga-gm-control-sheet/releases) and extract its `gga-gm-control-sheet` folder into `Data/modules/`.

## Open and use

As GM, press **Alt+G**, click the clipboard button in the token controls, or use **Configure Settings → Module Settings → GM Control Sheet → Open control sheet**.

Drag the horizontal dividers below the character list and Group actions to resize the sections. Each section scrolls independently, and your arrangement is saved. To restore the default layout, open **Configure**, tick **Reset section sizes**, and click **Save**.

See the [GGA GM Control Sheet User Guide](GGA-GM-Control-Sheet-User-Guide.pdf) for roster setup, private checks, player requests, modifiers, presets, and configuration.

## Active effects and requested roll results

With **Casting Assistant 0.5.0 or later** enabled, badges beside each character show spells they cast and effects they received, with remaining time or due maintenance. Click a badge to open the original caster's Active effects window. Self-cast effects appear once. The source records remain in Casting Assistant; the GM sheet does not duplicate timers or apply bonuses. Turn badges off under **Configure → Show Casting Assistant effects beside characters**. The module continues to work without Casting Assistant.

Choose **Requested roll results** beside Latest GM results to collect each request's effective targets, dice totals, outcomes, and margins alongside outstanding respondents. The panel reads the original roll messages and is available only to GMs. Blind outcomes are never copied to the shared request card. Keep both the original request and its roll messages in chat; older rolls without summary metadata are labelled accordingly. Reminders retain the original request and do not create another result.

## Help

Report problems through [GitHub Issues](https://github.com/Farmeroz/gga-gm-control-sheet/issues). Include your Foundry, GGA, and module versions, the action that failed, and any error message or screenshot.

## Licence

Released under the MIT licence; see `LICENSE.txt`.

An unofficial aid for GURPS Fourth Edition. GURPS is a trademark of Steve Jackson Games. This module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers.

## Help tooltips

Hover over a control or focus it with the keyboard for a short explanation. Press Escape to dismiss the help. Under **Configure Settings → Module Settings → GGA GM Control Sheet**, turn off **Show help tooltips** to hide optional help on your client. Labels, settings descriptions, and important notices remain visible. Other users keep their own preference.
