import http from "k6/http";
import { sleep, check } from "k6";

export const options = {
  vus: 10,
  duration: "10s",
};

export default function () {
  const res = http.get("http://localhost/api/space-weather/current");
  check(res, {
    "status is 200": (r) => r.status === 200,
    "transaction time < 500ms": (r) => r.timings.duration < 500,
  });
  sleep(1);
}
