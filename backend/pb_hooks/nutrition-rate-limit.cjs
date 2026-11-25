/* oxlint-disable import/no-commonjs */

const minute = 60_000;
const currentBucket = () => Math.floor(Date.now() / minute);

const reserve = (app, owner, estimate = false) => {
  const result = app
    .db()
    .newQuery(`INSERT INTO paideuo_nutrition_rate_limits (id, owner, bucket, requests, estimates)
      VALUES (substr(lower(hex(randomblob(8))), 1, 15), {:owner}, {:bucket}, 1, {:estimate})
      ON CONFLICT (owner, bucket) DO UPDATE SET
        requests = requests + 1, estimates = estimates + {:estimate}
      WHERE requests < 120 AND estimates + {:estimate} <= 10`)
    .bind({ owner, bucket: currentBucket(), estimate: estimate ? 1 : 0 })
    .execute();
  if (!result.rowsAffected()) throw new ApiError(429, "Nutrition request rate limit exceeded.");
};

const prune = (app) =>
  app
    .db()
    .newQuery("DELETE FROM paideuo_nutrition_rate_limits WHERE bucket < {:bucket}")
    .bind({ bucket: currentBucket() })
    .execute();

module.exports = { reserve, prune };
