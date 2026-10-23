// Drizzle table definitions go here. The btree_gist extension is installed in
// both databases, so rental tables can use exclusion constraints, e.g.
//   EXCLUDE USING gist (car_id WITH =, period WITH &&)
export {};
