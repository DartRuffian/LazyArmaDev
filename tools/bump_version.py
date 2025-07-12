#!/usr/bin/env python3

import json

def main() -> None:
    # package.json and package-lock.json are slightly different formats
    # both have a version key, but package-lock also has another in packages
    with open("package.json") as fin:
        data = json.load(fin)
        version = data["version"].split(".")  # major.minor.patch
        version = [int(i) for i in version]
        print(f"Current Version: {data["version"]}")
        if version[2] > 9:
            version[2] = 0
            version[1] = version[1] + 1
        else:
            version[2] = version[2] + 1
        if version[1] > 9:
            version[1] = 0
            version[0] = version[0] + 1

        version = ".".join([str(i) for i in version])
        data["version"] = version

        with open("package.json", "w") as fout:
            json.dump(data, fout, ensure_ascii=True, indent=4)

    with open("package-lock.json") as fin:
        data = json.load(fin)
        data["version"] = version
        data["packages"][""]["version"] = version

        with open("package-lock.json", "w") as fout:
            json.dump(data, fout, ensure_ascii=True, indent=4)

    print(f"Bumped Version: {version}")

    with open("CHANGELOG.md", "a") as f:
        f.write(f"\n\n## [Release {version}]\nRead on [GitHub](https://github.com/DartRuffian/LazyArmaDev/releases/tag/v{version})")

if __name__ == "__main__":
    main()
