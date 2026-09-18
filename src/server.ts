/* eslint-disable no-console */
import app from "./app";
import config from "./app/config";
import { prisma } from "./app/lib/prisma";

// import { Server } from "http";

// let server: Server;

// async function Main() {
//   try {
//     await mongoose.connect(config.mongo_database_url as string);
//     app.listen(config.port, () => {
//       console.log(`listening from port ${config.port}`);
//     });
//   } catch (error) {
//     console.log(error);
//   }
// }

// Main();

async function Main() {
  try {
    await prisma.$connect();
    app.listen(config.port, () => {
      console.log(`listening from port ${config.port}`);
    });
  } catch (error) {
    console.log(error);
  }
}

Main();

// process.on("unhandledRejection", () => {
//   console.log("unhandledRejection detected , shutting down !!! ");
//   if (server) {
//     server.close(() => {
//       process.exit(1);
//     });
//   }

//   process.exit(1);
// });

// process.on("uncaughtException", () => {
//   console.log("uncaughtException detected , shutting down !!! ");
//   process.exit(1);
// });
