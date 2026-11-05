I need an app that that will compare any amount of folders and tell me which of the files in each is not the same sane as the base dir. 
- It must be an innovative simple tui that I can run from any place on windows 11 by just typing fxdif anywhere. 
- By running it without any arguments the app assumes a new project is being created and should ask the user if he wants to create a new project.
- It musy ask the user for a new project name and indicating the folder name it is currently in as the default
- But ity could happen that a project is has already been added for the folder, so there must be a projects table, one of the column must be the path that gets saved like `C--dev-fxdif` which mean the project folder in windows is `C:\dev\fxdiff`. There also add all the typical columns like `id` auto increment, created_at, deleted_at (in this entire system ther will be no hard deletes, everything will be soft deletes by having a is_deleted column that defaults to 0 and when it is set to 1 then the record is deleted).
when `fxdif` is run in a folder that is a projecy folkder it must list all the files of each project folder in collumns and indicate which files an folders are not the same as the the selected marster columm. A user must either be anle to to press the alt+down arrow button to view the next files that is diffrent. I 
The app must aslo ask for a project code `project_code` column that must show default to be the same as the project name.
- When a user types fxdif in any folder like
```
fxdif {project_code}+
```
- then it added that as a folder that must be compare to the project folder for a diff, any amount of folders can be added

When the user types the following in a any folder
```
fxdif {project_code}-
```

It must first check if the folder is part of a project if it is it must update the is_deleted to 1 and no longer include it in the diff

if `fxdif {project_code}-` is run in any sub-folder of a project then it must exclude that sub-folder from the diff but only for that folder of the project

if `fxdif {project_code}-` is run in the main project folder in a sub-folder then that folder must not be part of the diff for any of the project folders

if `fxdif {project_code} .php+ .go+ .js+` is run in the main project folder then it means that for the entire project only those file extentions will be checked for diff's. So when no extensions are are added addede then it must diff all text based files

NOTE
it must always avoid diffing the .git, node_modules, composer, composer's folders python's cache folder and whatever fodlers all the different languages have. The easiest way to enforce this is to have  a  template for new projects where the a bunch of folders are added to avoid when a project is started

if `fxdif {project_code} .php- .go-` is run in the main project folder then it means that for the entire project ir must avoid diffing these file extenions


if `fxdif {project_code} .php- .go-` is run in one of the project's folders these rules are only for that folder


finally if `fxdif {project_code} file_name.php- another_fu=ile.go+`   if adde in the main fodler then this file must be excluded from all fodlersa and a '-' was specifeid and added even if the folder was avoided  but the file added with a +

So the idea is to have a diffing tool shat compares all the folders and files include and excuded. 

----

For the actuall diffing tool an intuitive tui verion must exists and I am doing to ask you to plan and build this but as long as the entire app can be compiles into a single file. I am leaning towards deno2 Because I think there need to be a web-version as well. that is hosted when a user types `fxdif --host` in this case the backend back be done done with Hono, froentend, React, ShadCN with Slate dark theme and te vscode text editor and be sure to add shortcut keys to the tui and web ui and to have help on both byt cli `fxdif --help` and button on the website