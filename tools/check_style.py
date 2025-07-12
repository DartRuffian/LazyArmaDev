#!/usr/bin/env python3

import fnmatch
import os
import sys

def check_style(filepath):
    bad_count_file = 0

    with open(filepath, "r", encoding="utf-8", errors="ignore") as file:
        content = file.read()

        lineNumber = 1
        indexOfCharacter = 0
        fileLength = len(content)

        for c in content:
            if (c == "\n"):
                lineNumber += 1
            elif (c == "\t"):
                print(f"ERROR: Tab detected at {filepath} Line number: {lineNumber}")
                bad_count_file += 1

            indexOfCharacter += 1

        file.seek(0)

    return bad_count_file

def main():
    print("Validating style")

    file_list = []
    bad_count = 0

    for folder in ["snippets", "src"]:
        for root, _, filenames in os.walk(folder):
            for filename in fnmatch.filter(filenames, "*"):
                file_list.append(os.path.join(root, filename))

    for filename in file_list:
        bad_count = bad_count + check_style(filename)

    print(f"------\nChecked {len(file_list)} files\nErrors detected: {bad_count}")
    if (bad_count == 0):
        print("Validation PASSED")
    else:
        print("Validation FAILED")

    return bad_count

if __name__ == "__main__":
    sys.exit(main())
