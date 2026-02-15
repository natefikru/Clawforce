import chalk from "chalk";

export const logger = {
  info: (msg: string) => console.log(chalk.gray(`  ${msg}`)),
  success: (msg: string) => console.log(chalk.green(`  ${msg}`)),
  error: (msg: string) => console.error(chalk.red(`  ${msg}`)),
  warn: (msg: string) => console.log(chalk.yellow(`  ${msg}`)),
  header: (msg: string) => console.log(chalk.blue.bold(`\n${msg}\n`)),
  step: (msg: string) => console.log(chalk.gray(`→ ${msg}`)),
};
