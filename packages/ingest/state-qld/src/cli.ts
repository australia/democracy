import { run } from "./index";

const dry = process.argv[2] === "dry";
run(dry)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
