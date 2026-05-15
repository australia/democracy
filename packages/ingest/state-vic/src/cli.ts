import { run } from "./index";

const mode = (process.argv[2] ?? "all") as "lower" | "upper" | "all" | "dry";

run(mode)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
