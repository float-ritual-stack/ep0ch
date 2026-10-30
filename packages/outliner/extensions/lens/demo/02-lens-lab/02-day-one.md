---
id: day-one
---
2031-03-02 [page::2031-03-02] [type::day]
The same line sits in ((day-two|the next day)): it reads `{{this.page}}`, so each day shows its own meetings.
lens:: query="type=meeting when={{this.page}}" columns=title,who,status edit=status choices-status="planned|held|cancelled" sort=title
