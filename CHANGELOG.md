# Changelog

All notable changes to CSV Grid Editor are documented here.

## [1.23.0] - 2026-09-23

### Added
- **A settings menu in the toolbar** - The gear at the right end of the toolbar opens a small menu for the switches that are a matter of taste. It sits in the editor rather than in the VS Code settings, where a switch is findable only by someone who already knows it is there. Every entry is remembered across files and sessions and has a line saying what it does. The gear is marked while anything in it differs from the default, so a grid that looks different says why. None of the switches changes a value in the file.
- **Files without a header row** - Many CSV files start with data, not with column names. The menu has a group **This file** with **First row is the header**. Switched off, the first line becomes row 1 and the columns are named A, B, C the way a spreadsheet names them. The choice is remembered for that file alone. Switching changes nothing in the file and does not mark it as changed. Such a file offers no **Rename column** and no "with header" copy entries, since it has no header to write to. Export names the columns A, B, C. Head, tail and paged views follow the switch too.
- **Switches for things that were fixed until now** - **Highlight the current row** takes away the wash on the row you are on, for anyone who finds it busy. **Type badges in the header** hides the `123`, `abc` and `T/F` badges, which gives a narrow column its name back. The type stays in the header tooltip. **Enter moves down after editing** can be switched off for people who expect Enter to save and stay in the cell. All three start the way the grid always was.
- **Align numbers to the right** - Off by default. Number columns line up on their last digit, the way a spreadsheet shows them, so magnitudes can be compared down a column.
- **Mark empty cells** - Off by default. A cell with nothing in it gets a faint hatch, so gaps in a column stand out instead of looking like the space between two values. It is drawn in the text color and reads on every theme. It is hatched rather than flat so it is never mistaken for a row stripe, a column color or a selection.
- **Checkboxes for true/false columns** - Off by default, switched on in the settings menu ([#41](https://github.com/Robin-Reiche/csv-grid-editor/issues/41)). A cell in a column of true/false values is drawn as a box instead of the word, which is quicker to read down a long column. One click flips it. The file keeps its own words: the click writes back the opposite word of the pair the cell already used, in the same capitalisation, so `YES` becomes `NO` and never `false`. Switching the mode on or off changes nothing in the file at all. `true/false`, `yes/no`, `y/n`, `t/f` and `on/off` are recognised. A value the box cannot stand for, an empty cell or a stray `unknown`, keeps its text so nothing disappears behind a box. Double-click beside the box to edit the value as text, as before. Shift or Ctrl+click on a box selects, it does not flip.
- **A short note after an update** - When an update brings new features, one small message says so. **What's New** opens the changelog and **Buy Me a Coffee** leads to Ko-fi for anyone who wants to support the work. The note comes once per feature release and never after a bug fix or a first install. **Don't Show Again** turns it off for good.

### Changed
- **Color columns moved into the settings menu** - It is something people set once and leave, so it no longer takes a toolbar button. A choice made before the update is kept. **Wrap cell text** stays in the toolbar, because it is switched while reading.
- **More columns are recognised as true/false** - `y/n`, `t/f` and `on/off` columns now carry the Boolean type badge and are profiled as true and false counts, which until now only `true/false` and `yes/no` columns were. A column has to speak one of those pairs almost throughout to count. A column mixing `yes` and `t` at random is text, as is a column of `1` and `0`, which reads just as well as numbers.
- **Large files open faster and need far less memory** - Reading a file now cuts each value straight out of the text. Reading a 113 MB file takes about half a second and 130 MB of memory, where 1.22.0 took 1.6 s and 223 MB.
- **The toolbar wraps in a narrow editor** - In a split editor the right end of the toolbar ran off the edge and could not be reached, the gear included. It wraps onto a second row now when it has to. The row count gives way first.

### Fixed
- **Line endings and the last line break survive an edit** - A Windows file with CRLF line endings came back with LF after the first edit, so git showed every line as changed. A file ending in a line break lost it. The grid now writes a file back the way it read it. Line breaks inside a quoted value were already kept and still are.
- **Spaces around a value survive an edit** - Values were trimmed as a file was read, so the first edit anywhere wrote the whole file back with the spaces around every value gone, in rows nobody had touched. The grid now keeps each value exactly as the file has it and writes it back that way. Whether the spaces are shown is the new **Hide spaces around values** switch. It is on by default, so the grid looks the same as before. Sorting, the value filter and Export go by what the grid shows. Duplicate detection still compares the values as the file has them.
- **An outside change no longer throws away unsaved edits** - When another program changed the file while the grid had unsaved edits, the grid quietly loaded the file and the edits were gone, while the tab still looked unsaved. The edits stay now and a warning says the file changed on disk, with **Reload from Disk** and **Overwrite** one click away. No save writes over the change until you pick one. Auto-save did, a moment after the warning offered to load the file. The warning comes back after a restart while the choice is still open. It names the file with its folder, so two files of the same name are told apart. A file without unsaved edits still reloads on its own as before.
- **Unsaved edits come back after a restart** - With hot exit on, VS Code keeps a backup of unsaved edits when it closes. The grid ignored it on the next start and showed the file from disk. It opens the backup now. If the file changed on disk while VS Code was closed, a warning says so, so the next save does not silently overwrite that change. A value still being typed in a cell comes back too, in files up to 10 MB. A backup left by 1.22.0 keeps the file's byte order mark.
- **A value being typed is saved** - Pressing Ctrl+S while a cell was still open saved the file without the value being typed. The tab looked saved all the same. File > Save, Save All, auto-save and a click elsewhere in VS Code did the same. Ctrl+W or the tab's close button closed the tab without asking. The tab now shows a value being typed as unsaved, closing asks first and every save writes the value. On a very large file the grid may not hand the value over in time. That save then says so and the tab stays marked unsaved. Auto-save and Save All leave the cell open while they do it. The key after Ctrl+K no longer lands in the cell and AltGr+S no longer closes it. Ctrl+Enter or Ctrl+Shift+Enter while typing wrote the value into another row, under a sort without showing it. It stays in its own row now. A value typed into a Source Control diff reaches the file's grid tab when the diff is closed. With the extension on another machine (Remote SSH, WSL, a container) or in a file over 1 MB, the grid tab gets the value only once the typing pauses for a third of a second. A mouse click on the diff's close button before that pause can lose what was typed since the last pause. Ctrl+W takes it along. Escape after typing leaves the tab marked unsaved, the way VS Code's own editor stays marked after typing a character and deleting it again.
- **Switching the delimiter keeps your edits** - Picking another delimiter from the badge read the file as it was when it was opened. Every edit since then was undone on screen and gone from the file at the next edit. An outside change is now read with the delimiter picked by hand, too.
- **Delete clears the cell you are on** - After moving with the arrow keys, Tab or Enter, Delete and Backspace cleared the cell last clicked, which could be far off screen.
- **A quote inside a value no longer swallows rows** - A value like `5" disk` opened the rest of the line and the rows after it as one long cell. A quote only starts a quoted value at the start of a field now, the way Excel reads it. Pasting such text and the large-file previews work the same way.
- **Edits in "Show only duplicates" land on the right row** - An edit, a delete or a paste in that view put back an old copy of the rows, so the next edit went into a different row. Switching the delimiter in that view did the same. A search that found no duplicates also takes its banner away once the data changes.
- **The columns follow undo and outside changes** - An undone column insert or delete left the grid showing the old columns. So did an outside change that added, removed or renamed columns. A restored column could not be seen and a deleted one stayed on screen. The grid builds its columns again when they changed. Header names, type badges and the sort order follow every change.
- **Replace shows what it replaced** - Replace and Replace All changed the file while the grid kept showing the old values. The replacement text is taken literally now, so `$$` is two dollar signs. Find and Replace only look at the columns you can see.
- **Save As from a preview writes the whole file** - Save As on a head, tail or paged preview wrote only what the preview held, which for the paged view was nothing. It copies the file now. Revert File leaves a preview alone instead of loading the whole file into it. Save As onto the file itself under another spelling, `BIG.csv` for `big.csv` on WSL, a USB stick or a network share, deleted the file. It is left alone now.
- **The byte order mark is kept** - Files saved by Excel often start with a UTF-8 byte order mark. Saving dropped it. Excel then showed umlauts wrong. It is written back now. The previews no longer show it in front of the first column name.
- **Files in other encodings keep them** - A file Excel saved as plain "CSV" (Windows-1252) or a UTF-16 file lost every umlaut on the first save, because the editor read everything as UTF-8. Such a file is read and written in its own encoding now. A UTF-8 file with a byte order mark and a few stray bytes from an older tool is read as UTF-8. Its stray bytes are written back as proper UTF-8. If an edit brings in a character that encoding cannot hold, the file is saved as UTF-8 with a byte order mark and a message says so. Head, tail and paged previews cannot show UTF-16 files yet. A Windows-1252 file with no umlaut in it cannot be told apart from UTF-8 and is treated as UTF-8.
- **Typing into a date column is kept** - When the first value of a column was a date like `2024-01-05`, the grid only accepted other dates there. Typing text or clearing the cell was silently thrown away. Every column takes any text now.
- **Undo gives back the exact file** - Undo after switching the delimiter wrote the old rows with the new delimiter, which turned the whole file into one quoted column. Undo and redo now bring back exactly the text they stand for, the delimiter included.
- **Classic Mac and Windows Python line endings** - A file whose rows end in a lone CR opened as one long row, also in the previews of large files. Rows ending in CR CR LF, as Python writes them on Windows, lost a byte each on the first edit. Both come back the way they were read now.
- **The delimiter is detected from the header only** - Separators inside a quoted column name no longer count, so `"Name, Vorname";Stadt` opens as a semicolon file. A save keeps the quotes such a header needs, so it opens the same way the next time. An inch mark in a column name like `Breite (")` is not taken for a quote.
- **A failed save keeps your edits safe** - When a save failed because the file was locked or read-only, the editor took the edits for saved. The next outside change then replaced them without a warning. It does not any more, also when the outside change comes while the save is still being written.
- **An outside change under an open cell editor** - A value being typed was written into another row when the file changed on disk at that moment. A value being typed counts as an unsaved edit now: the cell stays open on its row and the warning offers **Reload from Disk** and **Overwrite**. A cell opened with nothing typed yet closes without writing when the file reloads.
- **The diff view and the grid at the same time** - With a file's Source Control diff open next to its grid tab, outside changes, Revert File and Reload from Disk reached only one of the two. They reach both now.
- **File names with brackets** - A file named like `data[1].csv` or `report{2024}.csv` never reloaded after an outside change. It does now.
- **Reload from Disk clears the unsaved mark** - After reloading over unsaved edits the tab still looked unsaved, so closing it asked to save. Reload from Disk and Overwrite also work on a grid in a floating window and never act on another editor.
- **The header row switch follows the file** - After Save As or a rename the file opened with its first row as the header again.
- **Renaming or moving a file keeps its unsaved edits** - Renaming or moving a CSV in the Explorer while the grid had unsaved edits opened it again from disk. The edits were gone and the tab looked saved, so closing it asked nothing. The edits now go along to the new name and the tab stays marked unsaved, also after undoing the rename. A change on disk that was still waiting for a decision keeps waiting. A tab behind another shows the edits once it is brought to the front. A rename that fails marks the tab unsaved again after a few seconds, on a slow remote connection after up to half a minute and for a folder moved to another drive after about a minute. An edit made only in a Source Control diff opens in a grid tab of the new name.
- **Save As onto the file itself** - Choosing the file itself in Save As left the editor unaware of what the disk held, so a later outside change was missed. It counts as a save now.
- **The committed side of a diff** - For a large file the committed side of a Source Control diff showed the working copy in the previews. It offers only the views that can read the committed version now.
- **A file name can no longer break the editor** - A file name with a backslash, a quote or a line break in it kept the grid from loading. A crafted name could run script inside the editor page. Everything handed to the page is passed as data now.
- **Inserting a row while a filter is on** - The filter hid the new row and the focus jumped to the next visible row, so typing overwrote that row. The filter makes room for the new row now and the focus stays on it.
- **Find follows the grid** - After a sort, a filter, a frozen row, an edit, an outside change or an undo, the find marks sat on the wrong cells and Next went through them in the old order. The search runs again in place now and the active match stays on its cell when rows are inserted or deleted above it or columns to its left, also by undo and redo. Frozen rows are searched too, spaces the grid hides are not. When the file is emptied the counter says so. A search with very many matches no longer slows down sorting and scrolling.
- **Menus close when the rows change under them** - The row menu, the column menu, Rename and the column chooser stayed open across an outside change, an undo, a row shortcut or a paste and then acted on whatever row or column had moved into place. They close now. Menus that hold no place, like the settings, stay open.
- **Copy follows the display** - Copy, Copy with header and Copy as CSV leave off the spaces the grid hides, the same as Export. Copy from a frozen row put nothing on the clipboard and now copies its value. Ctrl+C in the find box or any other text box copies the text there instead of the cell behind it.
- **The value filter opens fast again** - It sorted its whole list on every open, which froze the editor for seconds on a column with many different values. Typing a condition no longer freezes for a second per key on a large file. On a column with more than 2000 different values, unticking one no longer hides every row past the first 2000 values.
- **Frozen rows stay on top** - Inserting a row while a sort was on moved the frozen rows to the end of the file. They stay first, the way the grid shows them.
- **Smaller fixes** - Ctrl+Enter starts a new row again after the last one was deleted. A last line of only spaces is no longer read as an extra row. Blank cells in a number column sort after the numbers. The column chooser and the profile name a blank column the way the header does. The popovers and their hover colors are readable in themes that pair a light editor with dark menus. Rebuilding the grid no longer leaves the old one running in the background. With **Hide spaces around values** off, the spaces show without Wrap cell text too. Escape on a menu puts the keyboard back on the grid. The column profile leaves the grid room in a narrow editor. The Columns button is marked only while a column is hidden. The Clear filters button shows only while a column filter is set. An unchanged value committed from the cell editor no longer marks the file unsaved. An empty last row added to a file without a final line break no longer disappears when the file is read again.

## [1.22.0] - 2026-09-19

### Added
- **Start a table from nothing** - A new, empty CSV could not be filled in at all, and one with only a header row could not get its first data row ([#40](https://github.com/Robin-Reiche/csv-grid-editor/issues/40)). Every way of adding was anchored to something already there: insert row needs a row to go next to, the row menu needs a cell to right-click and `Ctrl+Enter` needs a cell to start from. An empty file showed a blank area with nothing to click. It now shows **Add column** where the table would be, and a header with nothing under it shows **Add row** instead of "No Rows To Show". `Ctrl+Enter` adds that first row too, and both are ordinary undo steps. A filter that matches nothing still says "No Rows To Show", since there are rows, they are just not shown.
- **Right-click beside or below the table to make it bigger** - That space landed on no cell, so VS Code's own Cut, Copy and Paste menu came up with nothing in it that applied. It is where a person reaches to grow a table, and in a table started from nothing it is most of the view. It now offers **Add column** at the right end and **Add row** at the bottom, which goes through the same insert as the other row entries, so a sort or a filter behaves as it does everywhere else. Right-clicking inside a cell you are typing in keeps the usual menu, so Cut, Copy and Paste still work on the text.

### Fixed
- **With auto-save on, a save no longer takes back the edit after it** - The grid reloads when the file changes on disk, and it tells its own saves apart by comparing the file with what it holds. But a save is only reported after it is written, and with `files.autoSave` set to `afterDelay` the next edit can land in between. The file then held the save, the grid had already moved on, and the save's own echo was taken for a change from outside: the grid jumped back to the saved state and the newest edit was gone. It showed most plainly while adding blank columns to a new file, where everything vanished at once, but a cell edit made at the wrong moment was lost the same way. The grid now remembers what it last wrote and lets that echo pass however late it arrives. A real change from another program still reloads as before, and **Reload from Disk** still loads the file over unsaved edits.
- **A header of blank column names opens with its columns** - A file holding only `,,,,` is five unnamed columns, but it opened as an empty table, because a last line with nothing in it was dropped as a trailing blank line. That rule now leaves the only line of a file alone when it has a delimiter in it. A trailing blank line after real rows is still dropped.

## [1.21.0] - 2026-08-30

### Added
- **Copy a selection as CSV** - The right-click menu on a selected block gains **Copy as CSV** and **Copy as CSV with header** next to the two it already had. Same cells, comma instead of tab. Tabs are what Excel and Google Sheets read back as columns, so `Ctrl+C` and the plain **Copy** keep them, and the new pair is for the other half of the job: pasting into a real CSV file, a code snippet or a ticket. Values holding a comma, a quote or a line break are quoted per RFC 4180, so the block reads back as exactly the cells it came from. Note that a CSV block cannot be pasted back into this grid, which reads the clipboard as tab-separated, the same as it always has.
- **Click the zoom percentage to go back to 100%** - The zoom is remembered across files and sessions, so a size set once on a wide file followed you everywhere, and stepping back was up to five presses. The percentage between the two zoom buttons is now the way back: it brightens the moment you are away from 100%, and one click returns the grid to normal size. At 100% it goes quiet again and stays a plain readout, because there is nothing to reset.
- **`Ctrl+0` resets the zoom** - The same thing from the keyboard, which is where most people expect it: `Ctrl+0` is the reset in Firefox, Chrome, Edge and Word, and `Ctrl+NumPad0` is VS Code's own. Both work. Clicking a percentage to reset is a pattern almost nothing else uses, so the click alone would have stayed unfound; the tooltip on the label names the key, which is what turns one stumbled-upon hover into a shortcut you keep.

### Fixed
- **A long right-click menu no longer hides its own top entries** - The row menu is built per click and grows with what you have selected. Fully populated it outgrows a short editor pane, and it was placed by pushing it up until it fit, with nothing stopping it from going past the top edge. The entries up there were simply gone, and a clipped menu looks exactly like a whole one, so the copy entries appeared not to exist. It is clamped to the pane now, the way the column menu next door always was, and a menu taller than the pane scrolls instead of losing its ends.
- **The delete entries stay readable while you point at them** - Hovering **Delete row** or **Delete column** forced the label to white on top of the theme's error background. On a dark theme that background is a deep red and it read fine. On a light theme it is a pale pink, so the label all but vanished and the entry looked disabled exactly while the pointer was on it. The hover keeps the theme's error color now, which VS Code pairs with that background in both.

## [1.20.0] - 2026-08-28

### Added
- **The row you are on is marked, not just the cell** - On a wide table the blue box around a single cell is easy to lose. You look left to read the row numbers and you no longer know which line you were on. The whole row carries a faint tint of the theme's focus color now, and the `#` gutter shows the number in that color behind a thin bar, so the line you are on is findable from either edge of the table. It is deliberately much lighter than the cell's own border: the row says which line, the cell keeps saying which box. Frozen columns are covered too. Find matches, duplicate rows, the range selection and the column colors all keep painting on top of it, unchanged.

### Fixed
- **Typing works in the cell `Tab` moved to** - Type a letter into a cell and it opens for editing, the way it always has. Press `Tab` and the cell to the right opens as well, but nothing typed there arrived, and no key brought it back. The cell editor is a popup and sits outside the cell it covers. After an edit the grid hands the keyboard back to the cell itself, which for its own editors is where the input lives and for this one is an empty box that swallows every keystroke. The editor takes the keyboard back now whenever it lands there, so `Tab`, type, `Tab`, type carries across a row. `Enter`, `Esc`, clicking away and the arrow keys are untouched.

## [1.19.0] - 2026-08-26

### Added
- **`Ctrl+Enter` inserts a row below the one you are on** - Adding a row meant reaching for the mouse and the context menu, every single time ([#36](https://github.com/Robin-Reiche/csv-grid-editor/issues/36)). It is a key now, and it works while you are still editing a cell: the value you typed is committed first, then the blank row appears underneath it. An active sort, an active filter and a multi-row selection all behave exactly as they do from the context menu, because it is the same code path. A frozen row still inserts nothing, same as before.
- The key was not free. It used to be a third way to put a line break into a cell, next to `Alt+Enter` and `Shift+Enter`, and both of those are untouched. `Alt+Enter` is the one Excel uses and the one most people already have in their fingers, so the line break kept a key nobody has to learn. `Ctrl+Enter` is what VS Code's own editor uses for a new line below, which is much closer to what it now does in the grid.
- **`Ctrl+Shift+Enter` inserts a row above, `Ctrl+Shift+K` deletes one** - The other two keys VS Code puts on the same three jobs, so the grid does not ask anyone to learn a second set. Both follow the selection: with several rows picked in the `#` gutter they insert that many, or delete all of them, anchored to the selection edge, exactly as the context menu already did. A delete is a normal undo step, `Ctrl+Z` brings the rows back.

### Fixed
- **The arrow keys keep working after the grid changes** - Undo, redo, paste and every row insert or delete replace the grid's row data, and that quietly took the keyboard with it. The grid still drew its focus ring around a cell, so it looked ready, but the browser focus had dropped to nothing and no arrow key moved anything until a cell was clicked with the mouse again. The focus goes back onto the same cell after all of those now. Deleting the last row lands on the row that is now last, so you can keep going upwards from there.
- Closing **Find & Replace** with `Esc` and dismissing **Go to row** with `Esc` or **Cancel** hand the keyboard back to the grid for the same reason: the text box had the focus and nothing ever took it back.
- After an insert the focus sits on the new row, above or below, the way VS Code leaves the caret on the line it just made.
- **`Ctrl+Shift+Z` redoes** - It never has, in any version. The check asked for a lower-case `z` while Shift was held, and a browser reports the upper-case letter whenever Shift is down, so no keystroke could ever satisfy it. Every letter shortcut accepts both cases now. Undo and redo also moved into the same early key handling the row shortcuts use, so nothing on the page gets to consume them first.
- **`Ctrl+Z` inside an open cell takes back what you are typing** - While a cell was open for editing, `Ctrl+Z` reached past the unfinished edit and undid the last committed action instead, so typing `Alt+Enter` and then taking it back removed the row you had added a moment earlier and left the break sitting in the cell. An open cell keeps an undo of its own now: the text steps back and the editor stays open, the way a spreadsheet behaves. The steps are word by word, the way a browser's own text field and VS Code cut them, so one press takes back a word rather than a single letter or the whole edit at once. A line break, a deletion and a paste each get a step of their own, so `Alt+Enter` can be taken back without losing the words in front of it. `Ctrl+Y` and `Ctrl+Shift+Z` step forward again.
- The toolbar's **Undo** and **Redo** buttons follow the open cell's history too, rather than sitting greyed out while the grid had nothing of its own to take back. They do the same as the keys and no longer close the editor. Clicking one used to pull the focus out of the cell, which commits the edit and shuts the editor, and the click then undid the value it had just written. Outside an open cell nothing about undo and redo changes.

Thanks to [@z1lV3r](https://github.com/z1lV3r) for the request.

## [1.18.5] - 2026-08-22

### Fixed
- **The column type badges stay readable on a light theme** - The small chips that say what a column holds (`123`, `1.0`, `abc`, `T/F`, `date`) were drawn in colors picked for a dark background, and nothing swapped them out when the editor was light ([#35](https://github.com/Robin-Reiche/csv-grid-editor/pull/35)). The label sat at a contrast of 1.3 to 2.0 against the chip behind it, depending on the theme's panel color, where 4.5 is the readable minimum. It was there, you just had to lean in. Both places the chips appear were affected, the column header and the Column Profile panel. They carry a second palette for light themes now and read between 5.0 and 5.8. Dark themes keep exactly the colors they had.
- **The control character chip stopped disappearing with them** - The chip that names a control character in a cell (`LF`, `CR`, `TAB`) shares the colors of the date badge, so it was just as faint on a light background, 1.6 against the editor background. It reads at 5.6 now.
- The switch keys off the same rule the grid already uses to pick its own light or dark styling, so a high contrast light theme gets the light palette too rather than falling back to the dark one.

Thanks to [@yukina3230](https://github.com/yukina3230) for the change.

## [1.18.4] - 2026-08-20

### Fixed
- **The paged view reads the delimiter the file really uses** - A file over 50 MB written with semicolons or pipes opened in **Paged View** as a single column per row, the whole record sitting inside it ([#34](https://github.com/Robin-Reiche/csv-grid-editor/issues/34)). The delimiter is detected from the text the editor has just read, and the paged view has none of its own: its pages are served on demand, so detection looked at an empty string, found no separator to count and fell back to the comma. It reads the header line off the page index now, which is built a moment earlier and has been to disk already, so it costs nothing extra. **Show Head**, **Show Tail** and **Open Full File** were never affected, they all have their text in hand when detection runs, and a `.tsv` is still decided by its extension.
- **Switching the delimiter by hand no longer throws you back to page 1** - The re-parse works off the text the grid was handed, and in paged mode that was always the first page. Changing the delimiter on page 6 therefore showed page 1 while the pagination bar still said page 6. Every page that arrives keeps that text in step now.

## [1.18.3] - 2026-08-20

### Fixed
- **Auto-fit stops cutting off the longest value in a column** - After fitting, the single widest value in a column could still end in an ellipsis, and only that one, because it is the value the column is sized to and everything else has slack ([#30](https://github.com/Robin-Reiche/csv-grid-editor/issues/30)). On a 5,235-row export the one 174-character title in the column ended at "…Kaufman Astoria Studios, New Y".
- The cause was a step meant to help. Auto-fit widens every column before measuring, so the visible cells it calibrates its measurement against are not truncated, and it did that with 3000 px. That is wider than any editor pane, and the grid only renders the columns that are in view, so from the second column on there was nothing left on the page to compare against. The calibration was down to the first column alone, it only accepts values of eight characters or more, and on a file whose first column holds a row number it found none at all. It kept its neutral factor and corrected nothing, which was exactly the correction the widest value needed. Columns are widened to 400 px for that step now, wide enough that ordinary values are not cut off and narrow enough that several columns stay in view, and the cell measurement carries two percent on top of it for what is left over.
- Auto-fit also got a little quicker on wide files. Two diagnostic blocks left over from chasing this scanned every row of every column on each run and only ever printed anything for one particular file.

## [1.18.2] - 2026-08-20

### Fixed
- **A saved cell value comes back the way it went in** - Two ways a value quietly changed on its own, both only visible once it carries a line break, so both are as old as being able to type one ([#31](https://github.com/Robin-Reiche/csv-grid-editor/issues/31)). Neither broke a file, but in both cases saving wrote back something different from what was read, without saying so.
- **A line break at the start or the end of a value stopped disappearing.** Reading a CSV trims every field, and a line break is whitespace too, so a cell typed with a trailing empty line was written to the file correctly and came back a line shorter. Saving again wrote that loss into the file. Only spaces and tabs are stripped now. Measured over every CSV in this repo, 902,094 cells in 13 files, not one of them reads differently than before, which is the whole idea: the padding you want gone still goes.
- **An edited cell keeps CRLF.** The cell editor is a text box, and reading a value out of one turns every line break into LF, which is what the HTML spec asks for. A value that came from the file as CRLF therefore came back as LF the moment the cell was edited, even when the edit never went near the break, and the save then rewrote a line nobody had touched. The editor remembers the style the value arrived with and puts it back on commit.

## [1.18.1] - 2026-08-20

### Fixed
- **Show Head, Show Tail and Paged View stop tearing multi-line cells apart** - The three preview modes for files over 10 MB split the file on every line break without looking at quotes, so a cell holding a line break was read as several rows ([#32](https://github.com/Robin-Reiche/csv-grid-editor/issues/32)). Two things came out of that, and the second one is the loud one.
- The counts were wrong everywhere. On a 12 MB file holding 90,999 rows the banner claimed 96,463 in **Show Head** and 96,462 in **Show Tail**, off by every extra line a multi-line cell brings with it, and off from each other because head and tail counted on different paths.
- Wherever a cut landed inside a quoted cell, the quotes stopped pairing up from that point on and every comma in the rest of the buffer became a column separator. **Show Tail** on that file returned 58 rows instead of 1,000, most of them fragments of a single value standing as their own row, with 84 and 100 columns where the file has 8. **Paged View** had it per page: page 6 of the 55 MB file showed 28 rows instead of 500 and all of them were wrong, while pages 1 to 4 read perfectly fine, which is what made this easy to miss.
- All three now count and cut **records** instead of lines, so a preview shows exactly the rows **Open Full File** would show. On the same two files: 1,000 rows in head and in tail with the real total next to them, and 835 pages holding all 417,107 rows instead of 885 pages holding 395,005 of them. This closes the known limitation noted in 1.17.0.
- **The paged view finally says how much of the file it is showing** - **Show Head** and **Show Tail** write into the preview banner, **Paged View** never did, so the strip at the top of the grid stayed empty. It reads "Page 1 of 835, 417,107 rows in total" now and follows the paging. That number is only worth showing since the index counts records rather than lines, before this it would have claimed 442,136.
- **Show Tail** also stopped pulling the whole file into memory. It used to build an array of every line just to take the last thousand. One scan collects the record boundaries now, then only the header and the tail range are read back.

## [1.18.0] - 2026-08-19

### Added
- **Value distribution in the Column Profile panel** - Min, max, mean and median tell you the range a column covers but not the shape of what sits inside it, which is exactly the part that matters on skewed data ([#33](https://github.com/Robin-Reiche/csv-grid-editor/issues/33)). Numeric and date columns are now binned and drawn as a histogram under their detail card, with the range written below it. Hover a bar and it tells you the interval, how many rows fall into it and what share of the column that is. The overview table has a new **DIST** column with a thumbnail of the same shape for every column, so 60 columns can be scanned in one look and clicking a row still jumps to its card.
- Bin widths are derived from the data itself (Freedman-Diaconis), not from a fixed bin count. On a column where most values cluster low and a thin tail runs far out, a fixed count would put nearly everything into one bar and show nothing. A bin holding even a single row keeps a visible sliver for the same reason. Columns with no numeric axis get frequency bars for their most common values instead, and `time` columns finally show something in the panel at all, they used to render nothing below the row and null counts.

- **The Column Profile panel remembers its size and its dock side** - Dragging the panel wider or taller only held for the file that was open. Every new CSV put it back to the default width, so the same drag had to be repeated over and over. The size is now persisted like zoom, column colors and wrap, kept separately for the side docks and the bottom dock so switching between them does not carry a width over into a height. A size saved on a wide window is clamped on a narrow one, so the grid can never end up pushed off screen.

- **Filter the Column Profile by name** - A search box sits next to the overview title. Type part of a column name and the overview table and the detail cards below it both shrink to what matches, with the count in the title telling you how many of how many are left. `Escape` clears it. On a 48-column file, finding the one column you care about no longer means scrolling.

### Changed
- **The Column Profile is around four times faster** - On a 116,924 row by 48 column file it took 4.5 seconds to compute, which froze the panel every time the file was opened or an edit re-triggered it. It is now about 1.2 seconds, measured on the same file, with output verified identical field by field. Three things did it: cells are only trimmed when they actually carry whitespace, numeric and date columns are summarised off a typed array sorted natively instead of a `number[]` sorted through a JavaScript comparator, and the distinct count for those columns comes off that sorted array instead of a hash set over every value.
- One consequence worth naming: a numeric column now counts distinct **numbers** rather than distinct spellings, so `1.0` and `1.00` count once, not twice. A value that is not a number at all, an `N/A` in an otherwise numeric column, still counts on its own. Every other column type is unchanged and still counts distinct strings.

### Fixed
- **The Column Profile could fail outright on a large text column** - The length statistics spread the whole column into an argument list (`Math.min(...lengths)`), which throws a `RangeError` once the column holds more than roughly 125,000 non-empty values, and that took the entire panel down with it, not just those three numbers. It is a plain loop now.

- **Also published on Open VSX** - The extension was only on the VS Code Marketplace, so in Cursor, VSCodium, Windsurf, Gitpod and Theia it did not turn up in the extension search at all. Every release now goes to both registries, and both get the same package rather than two separate builds. Asked for by [@JunchengLu218](https://github.com/JunchengLu218) in [#33](https://github.com/Robin-Reiche/csv-grid-editor/issues/33).

Thanks to [@JunchengLu218](https://github.com/JunchengLu218) for the request and for pointing at Positron's Data Explorer as the reference, the two-tier layout there is what the overview table and the detail cards were already shaped like.

## [1.17.1] - 2026-08-19

### Fixed
- **A line break stays recognisable while wrapping** - With the wrap toggle on there was no way to tell whether a line ended because the value contains a line break or because it ran into the edge of the column. The `↵` chip is now drawn in both modes, so a break with a chip in front of it comes from the data and one without comes from the column. Reported by [@JeppeKlitgaard](https://github.com/JeppeKlitgaard) in [#29](https://github.com/Robin-Reiche/csv-grid-editor/issues/29), who builds tables by hand and wraps them to read the full text. The toggle is called **Wrap cell text** now, which is what it always did.
- **Copying a single multi-line cell** - `Ctrl+C` on one cell put the raw value on the clipboard, so a cell with a line break arrived in Excel as three separate cells and pasting it back into the grid produced three rows. It is quoted now, the same way copying a selected range has always done it. Ordinary values are unchanged.
- **Auto-fit makes room for the chips** - Auto-fit measured the raw value while the grid draws a chip for every control character and, since 1.17.0, for every line break. A chip is several times wider than the character it replaces, and a line break even collapses to a single space when it is measured as text, so a column with such a value came out too narrow and the value it was fitted to still ended in an ellipsis. The measurement now builds the cell exactly the way the grid draws it. Cells with chips are also kept out of the calibration step, where their mixed content skewed the correction factor for every column.

## [1.17.0] - 2026-08-14

### Added
- **Line breaks inside a cell** - A cell can now be given a line break while editing, with `Alt+Enter` like in Excel, or with `Shift+Enter` or `Ctrl+Enter` ([#29](https://github.com/Robin-Reiche/csv-grid-editor/issues/29)). The cell editor is a text box that grows with the value instead of a single-line field, and `Enter` still commits, so editing a normal value feels exactly as it did. Reading and writing such a file always worked, the quoted multi-line field is part of the CSV standard, there was just no way to type one.
- **Multi-line cells are visible** - A row is one line tall, which used to make a line break inside a cell invisible: "Hamburg\nGermany" looked the same as "Hamburg Germany". Every break now shows as a small `↵` chip, and hovering it says whether it is LF or CRLF. Display only, the value keeps the original characters.
- **Wrap multi-line cells** - A new toolbar toggle next to the color-columns button. With it on, cells break at their line breaks and each row grows to fit its tallest cell. It stays off by default because measuring every row costs time on large files, and the setting is remembered across files and sessions like zoom and column colors.

### Known limitation
- The three large-file modes for files over 10 MB (**Show Head**, **Show Tail**, **Paged View**) split the file on line breaks without looking at quotes, so a cell containing one is torn apart there. Those modes are read-only previews, **Open Full File** is not affected. Tracked as [#32](https://github.com/Robin-Reiche/csv-grid-editor/issues/32) and fixed in 1.18.1.

## [1.16.0] - 2026-08-13

### Fixed
- **The grid reloads when a script regenerates the file** - Auto-reload only reacted to a file being rewritten in place. A script that regenerates its output by deleting the file, or the whole output folder, and writing it fresh went unnoticed, so the grid kept showing the old data until you closed the tab and opened it again (reported in [#25](https://github.com/Robin-Reiche/csv-grid-editor/issues/25)). That kind of rewrite reaches the editor as a delete followed by a create, not as a change, and only the change was being handled. Both now trigger the reload, so a regenerated CSV shows up on its own.

### Added
- **CSV Grid: Reload from Disk** - A command in the Command Palette that pulls in the file on disk on demand. Worth knowing: **File: Revert File** cannot do this. VS Code only forwards a revert to an editor when the document has unsaved changes, so on a file you only changed on disk it does nothing at all, which is easy to mistake for a broken editor. The new command has no such condition and tells you when there was nothing to pull in.

Thanks to [@GiacomoEV](https://github.com/GiacomoEV) for the report and for patiently answering the follow-up questions that pinned this down.

## [1.15.1] - 2026-08-11

### Fixed
- **XML export parses everywhere, including headers with rare CJK** - A column header holding a character above U+FFFF, the range Mathematical letters and CJK Extension B live in, produced an element name that Python's standard library, PHP and Perl refuse to read. The newest edition of XML 1.0 allows such a name and libxml2 accepts one, but expat implements the older rule and rejects the tag wherever the character sits. Those characters are now replaced with an underscore like every other character that is not legal in an element name, so the file opens in any parser. Headers that stay inside the BMP ("Größe", "中文") are untouched. Shipped with the XML export in 1.15.0.

## [1.15.0] - 2026-08-11

### Added
- **Export as XML** - The Export menu has a fourth format next to JSON, JSON Lines and Markdown ([#26](https://github.com/Robin-Reiche/csv-grid-editor/pull/26)). It writes the current view as one `<row>` element per row with one child element per column, for the systems that still speak XML. Column headers become element names, and because XML names are far stricter than JSON keys, anything illegal in one (spaces, punctuation, a leading digit) is replaced so the output always parses, with headers that collapse onto the same name still kept apart. Cell text is written exactly as it reads, so a leading zero or a trailing decimal zero survives. Control characters are the one thing that cannot come along: XML 1.0 has no way to represent them, so they are dropped. The other three formats keep them.
- **Control characters say what they are** - A control character inside a cell value has no glyph in the UI font, so the grid drew an anonymous box and there was no way to tell which character it was without exporting the file ([#28](https://github.com/Robin-Reiche/csv-grid-editor/pull/28)). Machine-generated CSVs use these as in-value separators and exports from older systems leave stray bytes behind, so the box turns up more often than you would expect. They now show as a small chip carrying the ASCII abbreviation, with the full name on hover (`U+001D GROUP SEPARATOR`). Display only, so the value itself is untouched and editing, copy, find and replace and save all keep the original character.

### Fixed
- **Zoom scales the grid, not the toolbar** - Zooming scaled the toolbar, footer and column profile panel along with the data ([#27](https://github.com/Robin-Reiche/csv-grid-editor/pull/27)). That was worse than cosmetic: every step re-laid out the toolbar, so the zoom buttons slid sideways under the pointer and a second click landed on the neighbouring button. Zooming twice in a row was a coin flip. Zoom now changes only the row height, header height, cell font and cell padding, the way the editor's own font-size zoom behaves, and everything around the grid keeps its size at every level.

Thanks to [@yukina3230](https://github.com/yukina3230) who contributed all three changes in this release.

## [1.14.0] - 2026-08-03

### Changed
- **Unfreeze has its own icon** - **Freeze** and **Unfreeze** sat under each other in the context menu with almost the same pin icon, so nothing about the picture told you which one undid the other. Unfreeze now uses a pin with a slash across it, in **Unfreeze column**, **Unfreeze all columns**, **Unfreeze row** and **Unfreeze all rows** ([#24](https://github.com/Robin-Reiche/csv-grid-editor/pull/24)). The icon font is bundled with the extension, so this came with an update of the codicon set it ships.

Thanks to [@yukina3230](https://github.com/yukina3230) for the change.

## [1.13.1] - 2026-06-25

### Fixed
- **The grid works offline now** - The grid library (AG Grid) was loaded from a CDN, so on a machine without internet the editor was stuck on "Loading…" and never showed the data (reported in [#23](https://github.com/Robin-Reiche/csv-grid-editor/issues/23)). It is now bundled with the extension and loaded locally, so opening a CSV no longer needs a network connection. This also helps anyone behind a strict firewall or where the CDN is blocked. And it means the extension no longer reaches out to a third party every time you open a file.

Thanks to [@leohao6762](https://github.com/leohao6762) for reporting it.

## [1.13.0] - 2026-06-19

### Added
- **Escape closes the open menu or popup** - Pressing `Esc` now dismisses whichever menu, dropdown or popover is open: the column and row context menus, the Export and Delimiter dropdowns, the column chooser, Go to row, the rename popover and the per-column filter panel ([#22](https://github.com/Robin-Reiche/csv-grid-editor/pull/22)). It only steps in when a popup is actually open, so `Esc` still cancels a cell edit as before.

### Changed
- **Tri-state "Select all" in the column chooser and the value filter** - The **Show / hide columns** menu and the per-column value filter each used to have two buttons (Show all / Hide all, Select All / Deselect All). Both are now a single tri-state **Select all** master checkbox that ticks when everything is selected, shows a dash when only some is and carries a `checked / total` count, the familiar spreadsheet control (requested in [#19](https://github.com/Robin-Reiche/csv-grid-editor/issues/19)). When you type in the search box it scopes to the matches and relabels to **Select all matches**, so the count stays honest while a search is active ([#20](https://github.com/Robin-Reiche/csv-grid-editor/pull/20), [#21](https://github.com/Robin-Reiche/csv-grid-editor/pull/21)).

Thanks to [@yukina3230](https://github.com/yukina3230) who contributed all three changes in this release.

## [1.12.0] - 2026-06-16

### Added
- **Search and Hide all in the column chooser** - The **Show / hide columns** menu now has a search box that filters the column list by name, plus a **Hide all** button next to the existing **Show all** (requested in [#18](https://github.com/Robin-Reiche/csv-grid-editor/issues/18)). On a wide file the flow becomes: Hide all, then type to find the few columns you want and check them, instead of unchecking dozens one by one.

### Changed
- **Export now leaves out hidden columns** - Exporting to JSON, JSON Lines or Markdown used to still include columns you had hidden in the column chooser. It now exports only the visible columns, which matches how copy already behaved, so the output is exactly what you see (follow-up to [#18](https://github.com/Robin-Reiche/csv-grid-editor/issues/18)).

## [1.11.1] - 2026-06-15

### Fixed
- **An open menu or dropdown now closes when you open another** - The context menus, the Export and Delimiter dropdowns, the column chooser, Go to row and the rename popover are now mutually exclusive: opening one closes any other that is still open (reported in [#15](https://github.com/Robin-Reiche/csv-grid-editor/issues/15)). A central coordinator routes every opener through a single close step. The 1.11.0 release fixed the popup positioning but not this staying-open behaviour.

## [1.11.0] - 2026-06-15

### Added
- **Column color mode** - A new toolbar toggle gives every data column its own theme-aware background tint, so wide tables are easier to scan and columns are easy to tell apart (requested in [#16](https://github.com/Robin-Reiche/csv-grid-editor/issues/16)). Each column gets a distinct hue spread by golden-angle rotation, so adjacent columns stay far apart on the color wheel even after you insert or delete one. The tint is a translucent overlay that adapts to light, dark and high-contrast themes and never fights the text, and existing highlights (range selection, find matches, duplicates and frozen rows) keep painting clearly on top. The toggle is remembered across files and sessions, like zoom.
- **Select all from the corner** - Click the top-left corner of the grid to select every cell at once, the same as a spreadsheet ([#12](https://github.com/Robin-Reiche/csv-grid-editor/pull/12)).
- **Unfreeze all** - Clear every frozen row and column in one action instead of unfreezing them one at a time ([#14](https://github.com/Robin-Reiche/csv-grid-editor/pull/14)).

### Changed
- **Menu icons use Codicons** - Context-menu and dropdown icons were emoji that rendered differently on each platform. They now use VS Code's Codicon set, so they match the rest of the editor and look the same everywhere ([#11](https://github.com/Robin-Reiche/csv-grid-editor/pull/11)).

### Fixed
- **Menus and popups behave correctly** - An open menu or dropdown stayed open when you opened another, and the context menu and rename popup could land in the wrong spot. Opening a menu now closes any other, and popups line up with the cell or header they belong to (reported in [#15](https://github.com/Robin-Reiche/csv-grid-editor/issues/15)).

## [1.10.1] - 2026-06-13

### Changed
- **Rename a column from the right-click menu only** - Removed double-click-to-rename on a column header. A single click already sorts the column, so quickly clicking to toggle the sort direction was sometimes read as a double-click and opened the rename popup by mistake (reported in [#10](https://github.com/Robin-Reiche/csv-grid-editor/issues/10)). Renaming stays available via right-click → **Rename column**.

## [1.10.0] - 2026-06-12

### Added
- **Freeze multiple rows** - You can now pin more than one row to the top at once, which makes multi-line headers (a group row plus a unit row, for example) stay readable while you scroll (requested in [#9](https://github.com/Robin-Reiche/csv-grid-editor/issues/9)). Select several rows (drag or `Shift`+click the `#` gutter) and choose **Freeze N rows**, or keep adding rows one at a time, freezing is additive and the rows stay in the order you froze them. Right-click a pinned row to **Unfreeze** just that one, or **Unfreeze all rows**. This also covers the multi-level-header use case from [#8](https://github.com/Robin-Reiche/csv-grid-editor/issues/8) without changing the CSV.
- **Freeze multiple columns at once** - `Shift`+click several column headers and choose **Freeze N columns** to pin them all in one go, the companion to multi-row freeze.

### Fixed
- **Freezes were lost during normal editing** - Frozen rows and columns are now preserved across deleting and inserting rows or columns, undo and redo, saving, and changing the delimiter, and frozen rows survive an external reload. Previously any of these could silently clear the freeze because the grid rebuild or re-parse lost track of the pinned rows and columns.

## [1.9.0] - 2026-06-12

### Added
- **Insert and delete multiple rows or columns** - Select several rows (drag or `Shift`+click the `#` gutter) or several columns (`Shift`+click the headers), then right-click to insert or delete all of them at once. Inserting adds as many rows or columns as you selected and lands them at the selection edge, the same as Excel and Google Sheets (requested in [#7](https://github.com/Robin-Reiche/csv-grid-editor/issues/7)). Single-row and single-column insert and delete still work as before when nothing is selected. Non-contiguous `Ctrl`/`Cmd` selection is intentionally out of scope for now.
- **Enter moves to the next cell** - After editing a cell, pressing `Enter` commits the change and moves the selection one row down in the same column, so you can type down a column without reaching for the mouse (requested in [#6](https://github.com/Robin-Reiche/csv-grid-editor/issues/6)).

### Fixed
- **Grid jumped to the top after deleting a row or pasting** - Deleting a row, pasting a value or inserting a row scrolled the grid back to the first row and lost your place in large files. The grid now keeps its scroll position across these edits, and undo and redo, by giving rows a stable identity so AG Grid updates them in place instead of rebuilding the whole grid (reported in [#5](https://github.com/Robin-Reiche/csv-grid-editor/issues/5)).
- **Counters and Column Profile went stale after structural edits** - The "rows × columns" and "records" counts in the toolbar and status bar did not update after deleting or inserting rows or columns, and the Column Profile panel kept showing pre-edit values. Both now refresh after every delete, insert, paste and undo, honouring any active filter.

## [1.8.0] - 2026-06-10

### Added
- **Export as JSON, JSON Lines and Markdown table** - The Export button now opens a small menu with three formats (requested in [#4](https://github.com/Robin-Reiche/csv-grid-editor/issues/4)). Every format exports the current view: filters, sort order, renamed headers and column order are all applied, and a frozen reference row is exported first. JSON exports an array of objects with the column headers as keys. Numbers and booleans come out typed, but never lossily: IDs with leading zeros, numbers too large for JSON and stray text in numeric columns stay strings, and empty cells in typed columns become `null`. JSON Lines writes one compact object per line for streaming tools. Markdown writes a GitHub-flavored table with right-aligned numeric columns, ready to paste into a README or issue.

### Removed
- **Export as CSV** - Removed because saving the file already writes CSV. The export menu now focuses on converting to other formats.

## [1.7.3] - 2026-06-09

### Changed
- **Marketplace listing and discoverability** - Expanded the search keywords and switched the second category to Data Science, rewrote the displayName and description to lead with what the extension does, and added homepage, bugs, Q&A, gallery banner and pricing metadata. No functional changes to the editor.
- **README** - Reworked for clarity and search with a keyword-first intro, a Contents list, Why / Who it is for / Quick start sections, an honest How it compares table, an FAQ, two short demo GIFs and clearer image alt text.

## [1.7.2] - 2026-06-08

### Fixed
- **README badges** - The Version / Installs / Rating badges were broken because their provider is not on the Marketplace's allowed badge-host list (and shields.io has retired its Marketplace badges). Switched to `badgen.net`, which is allow-listed and serves live data.

## [1.7.1] - 2026-06-08

### Added
- **Sponsor / support links** - A **Sponsor** button (GitHub Sponsors) now appears on the extension page, and the README has a Support section linking GitHub Sponsors and Ko-fi for anyone who would like to support development. Entirely optional.

## [1.7.0] - 2026-06-08

### Added
- **Rename columns** - Double-click a column header, or right-click it → **Rename column**, to rename it. The new name is written to the CSV header row and is fully undoable; column widths, sort and freeze state are preserved.
- **Show / hide columns** - A new toolbar button opens a column chooser: a checklist of every column with checkboxes to hide or show individual columns, plus **Show all** to reset. Hidden columns persist across paged-view page changes. Export still includes all columns.

## [1.6.1] - 2026-06-08

### Added
- **Freeze row** - Right-click any row and choose **Freeze row** to pin it to the top of the grid as an always-visible reference while you scroll, sort and filter the rest of the data; right-click the pinned row and choose **Unfreeze row** to release it. One row can be frozen at a time. Like Freeze column it is a view aid (also available in read-only previews) and is not persisted across reload. A 📌 marker on the pinned row's `#` cell shows its original row number, so it never reads as a duplicate of the body row that renumbers into its place. A frozen row stays visible regardless of any active column filter, and the feature is mutually exclusive with the duplicate-rows view.
- **Freeze markers** - Frozen columns now show a 📌 marker before the column name, matching the frozen-row marker, so pinned columns and rows are easy to spot at a glance.

## [1.5.5] - 2026-06-03

### Fixed
- **Cell edits landed on the wrong row under an active sort or filter** - Editing a cell while the grid was filtered and/or sorted wrote the new value to the wrong row in the underlying CSV (the row at the same *display* position in the unfiltered/unsorted data), corrupting data silently. The edit handler now maps the edited row back to its source position via `_origIndex` instead of the display row index. The default unsorted/unfiltered view was unaffected.
- **Find & Replace had the same wrong-row bug** - Replace / Replace All wrote substitutions to the wrong rows whenever a sort or filter was active. Matches now capture the row's `_origIndex` at search time so replacements always hit the correct row.
- Added regression tests for both index-mapping paths (`test/`).

## [1.5.4] - 2026-05-27

### Fixed
- **Large-file picker cancellation** - Dismissing the "How would you like to open this file?" picker for large CSVs left the editor tab in a broken state and surfaced a `Canceled: Canceled` entry in the Output log; clicking the file again would surface the cached error instead of re-showing the picker. `openCustomDocument` now returns a sentinel "cancelled" document instead of throwing `CancellationError`, and the matching tab is closed via the `tabGroups` API on the next microtask. `resolveCustomEditor` returns early for the sentinel without touching the webview, avoiding the `OverlayWebview has been disposed` race that an immediate panel-dispose would otherwise trigger. The picker also no longer dismisses on accidental focus loss (use `Esc` to cancel explicitly).

## [1.5.0] - 2026-05-16

### Added
- **Inline range selection** - Excel-style cell selection directly in the grid. Click and drag to select a rectangular range, drag the row-number (`#`) column to select whole rows, or right-click a column header → **Select column**. `Shift`+click and `Shift`+arrow keys extend the selection; `Ctrl+A` selects everything. `Ctrl+C` copies the selection as tab-separated values; right-click → **Copy with header** to include column headers. `Delete` / `Backspace` clears the selected cells. The status bar shows the selection size plus live Count / Sum / Avg / Min / Max.
- **Paste** - paste tab- or comma-separated clipboard data straight into the grid, starting at the focused cell. Integrates with the undo stack.
- **AND / OR filter conditions** - each condition in a column filter can now be joined with AND *or* OR (previously AND-only). Click the operator pill between two conditions to toggle it; AND binds tighter than OR.

### Changed
- **Unified iconography** - every icon (column headers, toolbar, profile panel, banners) now comes from a single VS Code Codicon family, replacing the previous mix of hand-drawn SVG, Unicode glyphs and emoji. Header sort and filter glyphs are sized and centred consistently.
- A column's filter funnel now fills solid white while a filter is active on that column, making filtered columns easy to spot.

### Removed
- The standalone **Select & Copy** mode (a separate read-only view), superseded by the inline range selection above.

## [1.3.4] - 2026-05-05

### Fixed
- **Critical:** Webview CSS and codicon font were missing from the published package because `media/` was gitignored in its entirety. The CI build only generated `media/webview.js` via esbuild, so the static stylesheet and codicon assets were never produced, leaving the grid unstyled in the Marketplace install. `media/webview.css` is now tracked, and a new `copy-codicons` build step copies `codicon.css` / `codicon.ttf` from `node_modules/@vscode/codicons` on every compile.

## [1.3.3] - 2026-05-03

### Fixed
- Marketplace publish workflow: switched the badge URLs from `.svg` to `.png` because `vsce` rejects SVG images from non-allowlisted hosts and was failing the publish step.
- Workflow now invokes `npx @vscode/vsce` instead of the deprecated `npx vsce` to clear the rename deprecation warning.

## [1.3.2] - 2026-05-03

### Fixed
- README: Marketplace badges now display real version, install count, and rating instead of the literal "Retired Badge" text. The previous shields.io endpoint relied on a Microsoft API that has been discontinued; switched to vsmarketplacebadges.dev which queries the live Marketplace gallery.

## [1.3.1] - 2026-05-03

### Changed
- README: Added Marketplace installs and rating badges alongside the existing version badge.

## [1.3.0] - 2026-05-03

### Added
- **Go to Row** - New toolbar button (and `Ctrl+G` / `Cmd+G` shortcut) opens a popover where you can type any row number and jump directly to it. The target row briefly flashes blue to confirm navigation. Disabled in Paged View.
- **Duplicate Row Detection** - New toolbar button scans every row and highlights duplicates with an amber tint. A banner reports the number of duplicate rows and how many groups they form.
  - **Show only duplicates** - Filters the grid to duplicates only, sorts matching rows next to each other, and switches the `#` column to show the original CSV line number of each row so you can locate them in the source file.
  - **Dismiss** restores the full table at any time.
  - Duplicate state is automatically cleared when you edit cells, undo/redo, delete rows/columns, or the file changes externally.
  - Disabled in Paged View.

## [1.2.2] - 2026-04-14

### Added
- Delete row and column support
- Freeze columns feature
- Zoom in/out for the grid

### Changed
- Webview refactored to modular TypeScript architecture
- Improved auto-fit column algorithm (3-phase sizing)
- Enhanced toolbar button styles

## [1.2.0] - 2025-10

### Added
- Undo/Redo support
- Find & Replace
- Export to CSV/TSV
- Pagination controls
- Profile/settings persistence
- Select & Copy support
- Theme integration (VS Code light/dark/high-contrast)
- Custom combined filter (checkbox + condition filter per column)

## [0.5.0] - 2025-03

### Added
- Delimiter auto-detection and manual override
- AG Grid Community integration for sortable, filterable grid

### Changed
- Version bump to 0.5.0, toolbar style improvements

## [0.3.0] - 2025-02

### Added
- Clear filters button
- Filter status indicator
- Numeric column detection for correct sort behavior

## [0.2.0] - 2025-01

### Added
- Extension icon
- Renamed to CSV Grid Editor

## [0.1.0] - 2024-12

### Added
- Initial public release
- CSV/TSV file viewer as VS Code custom editor
- Basic grid view with AG Grid
