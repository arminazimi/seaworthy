# Seaworthy name and logo: use policy

**Status:** draft for the maintainer to approve (task `brand.policy`, issue #184).

The Seaworthy source code is licensed under Apache-2.0, which lets you use, change, and share the code. Section 6 of that license does not grant any right to the project's name or logo. This policy says what you may do with them without asking.

## You may, without asking

- **Say that you use or support Seaworthy.** "Verified with Seaworthy", "Works with Seaworthy", "Seaworthy check passed". Use the name in plain text.
- **Show the status badge** from `brand/assets/badge-*.svg` or the badge service, unmodified, on a site or repository that really runs Seaworthy. A badge that says "passing" must not be shown for a site that is not verified.
- **Write about Seaworthy**: articles, talks, videos, comparisons, and reviews, including critical ones. Use the name and the unmodified mark to refer to the project.
- **Use the name for a direct integration** when it is clear which part is yours and which is ours: "Acme plugin for Seaworthy" is fine; "Seaworthy Plugin" on its own is not.
- **Fork the code** and run it. A fork must not present itself as the official project (see below).

## You may not, without written permission

- **Name your product, company, domain, package, or account** Seaworthy, or something confusingly close to it (`seaworthy-pro`, `getseaworthy`, `seaworthy.ai`), where it would suggest that it is the official project or endorsed by it.
- **Change the mark**: no recoloring outside the approved variants, stretching, adding effects, or combining it with another logo into a new one. Use the files in `brand/assets/` as they are (see `BRAND_GUIDE.md`).
- **Suggest endorsement**: no "official", "certified by Seaworthy", or "Seaworthy approved" unless the project has agreed to it.
- **Sell merchandise** or paid services under the name or logo.

## Forks and redistributions

A fork or a redistributed build that changes the code in a way users would notice must use its own name and logo. Say what it is based on: "based on Seaworthy". Keeping the license notices is required by Apache-2.0 and is not the same as using the name.

## Reports and false claims

A report, badge, or screenshot that says it came from Seaworthy but was edited by hand is a false claim, and we may ask for it to be removed. The `--format json` report carries the tool version and a fingerprint of every finding so claims can be checked.

## Asking and reporting

Open an issue labeled `brand` in this repository to ask for permission or to report a misuse. Say what you want to make, where it will appear, and for how long. We answer in the issue so the answer is public.

## Changes

This policy is part of the repository. Changes go through a pull request like any other change. It does not give legal advice, and it does not replace the license. Seaworthy has no registered trademark yet; if one is registered later, this policy will say so.
