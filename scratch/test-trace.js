const { iterativeTrace } = require('../app/server/dns-iterative');

async function test() {
  console.log("Running trace for google.com...");
  try {
    const start = Date.now();
    const result = await iterativeTrace("google.com", "A");
    console.log(`Success! Trace finished in ${Date.now() - start}ms.`);
    console.log("Hops count:", result.hops.length);
    console.log("Edges count:", result.edges.length);
    console.log("Hops summary:");
    result.hops.forEach(h => {
      console.log(` - ID: ${h.id}, Step: ${h.step}, Type: ${h.type}, Label: ${h.label}, isSubTrace: ${h.isSubTrace}`);
    });
  } catch (err) {
    console.error("Error during trace execution:", err);
  }
}

test();
