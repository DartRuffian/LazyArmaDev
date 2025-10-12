#!/usr/bin/env python3

import os
from bump_version import bump_version

def main():
    version_str = bump_version()
    print(version_str)

    os.system(f"git tag v{version_str}")
    os.system("git push --tags")

if __name__ == "__main__":
    main()
