const raceWhich = async (queue) => {
  let [completed] = await Promise.race(queue.map((p) => p.then((res) => [p])));
  const index = queue.findIndex((p) => p === completed);
  return [await completed, index];
};
export default raceWhich;
