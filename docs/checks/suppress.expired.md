# suppress.expired

A suppression has passed its expiry date, so it no longer applies and the finding it hid is back.

## Why it matters

Suppressions are meant to be temporary. An expiry date makes someone look again instead of letting accepted problems rot.

## What it checks

Inline suppressions with `until YYYY-MM-DD` and config suppressions with `expires` are live through the end of that day (UTC). After that they stop applying and are reported here.

## How to fix

Fix the underlying problem and delete the suppression. If it must stay, extend the date and update the reason so the next reader knows why.

## Options

None.

## Standards

None.
