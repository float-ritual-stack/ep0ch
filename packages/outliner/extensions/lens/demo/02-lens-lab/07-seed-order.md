---
id: seed-order
---
Seed order
A computed column and a footer: `cost="qty * price"`, `sum=cost,qty`. Change a quantity below and the sum follows.
lens:: query="type=seed-line under:this" columns=title,qty,price,cost cost="qty * price" sum=cost,qty sort=title
