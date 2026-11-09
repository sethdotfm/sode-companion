# Sode Companion

A Bitfocus Companion module that runs a Sode panel on Companion buttons, plus a generator that builds the Companion page for it. Sode's own terms (Panel, Cell, Cell kind, Viewed destination, Staged, Armed, Take mode, Instant mode, Clear, Current Destination, Rights, Instance) keep the meaning in Sode's GLOSSARY.md.

## Language

**Surface**:
A physical Companion control device, such as a Stream Deck. A surface shows a window onto a page.
_Avoid_: Hardware panel (Sode's word for a physical router panel), deck, controller

**Page**:
One Companion grid of buttons. The generator builds a page that holds one panel.
_Avoid_: Layout, screen

**Connection**:
One configured use of this module in Companion. It runs exactly one Panel as exactly one Sode Instance.
_Avoid_: Instance (Companion's code uses it, but Sode gives it another meaning), integration, module instance

**Key square**:
One button position on a page. A Cell sits on one key square, or on several when it is a Merged cell.
_Avoid_: Slot, tile

**Root square**:
The top-left key square of a Merged cell. It alone shows the cell's text. The other key squares of the cell show only its colour, and pressing any of them presses the cell.
_Avoid_: Anchor, parent

**Bound position**:
A button's row and column on the Panel's grid. A button follows whichever Cell is at its bound position, so a saved edit in Sode reaches it without regenerating the page.
_Avoid_: Cell binding, cell id

**Generator**:
The standalone script that reads a Panel from Sode and writes an importable Companion page of buttons bound to a Connection. It is built to be lifted into Sode as a Share feature.
_Avoid_: Exporter, importer

**Artwork**:
An uploaded image that a Cell names by id. A key with Artwork shows it inset under the label, framed by a Border.
_Avoid_: Image, thumbnail

**Icon**:
A built-in icon that a Cell names with an `icon:` prefix. A key with an Icon keeps the solid state colour and draws the Icon over it in the key's text colour.
_Avoid_: Glyph, symbol

**Border**:
The state colour drawn as a frame around the picture of a key square with Artwork. A merged Cell has it on the group's outer edges only.
_Avoid_: Outline, frame

**Key picture**:
The processed image shown on one key square, published as that square's picture variable. A merged Cell's picture is cut across its squares.
_Avoid_: Thumbnail, icon (that is an Icon)

**Offline**:
The state where Sode or the router is unreachable. Every button of the page shows Offline and presses are ignored.
