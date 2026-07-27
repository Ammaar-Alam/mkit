# Troubleshooting

## MKit is not shown

Open the MKit popup and confirm that **MKit** is On. Fresh Attempt runs on a
completed full-length answer review or completed section Review All question at
`www.mcatofficialprep.org`. The completed section score report can also hide its
per-question result marks.

If a supported page was already open when MKit was installed or updated, reload
the extension from the extension manager, then reload that page.

## The review remains covered

MKit could not verify the page layout strongly enough to guarantee spoiler
protection. Use **Try again** after the page finishes loading. **Normal review**
restores the native review when you intentionally want to see it.

You can also turn **MKit** Off from the popup. This releases supported pages in
the current browser without deleting your Fresh Attempt progress. A reload is
only needed if an older content script does not acknowledge the change.

Do not disable the cover just to work around another extension. First disable extensions that restyle pages, translate content, replace fonts, or alter accessibility attributes, then reload.

## Progress did not sync

MKit always writes to the current device first. Browser sync is best-effort and depends on the browser profile. When notes exceed the conservative sync budget, the full notes remain local and MKit shows **Some notes are only on this device**.

## Reporting a compatibility issue

Use the options page to review the compatibility log. It contains event codes and capability counts, never questions, answers, explanations, scores, or account data. Do not attach authenticated screenshots or copied practice content.
