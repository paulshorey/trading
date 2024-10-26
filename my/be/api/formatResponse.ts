import { NextResponse } from "next/server";

export const formatResponse = (datas: Record<string, any>, status: number = 200) => {
  // for (let k1 in datas) {
  //   if (typeof datas[k1] === "object" && datas[k1] !== null) {
  //     for (let k2 in datas[k1]) {
  //       if (datas[k1][k2] instanceof Uint8Array) {
  //         datas[k1][k2] = Array.from(datas[k1][k2]);
  //       }
  //       if (typeof datas[k1][k2] === "object" && datas[k1][k2] !== null) {
  //         for (let k3 in datas[k1][k2]) {
  //           if (datas[k1][k2][k3] instanceof Uint8Array) {
  //             datas[k1][k2][k3] = Array.from(datas[k1][k2][k3]);
  //           }
  //         }
  //       }
  //     }
  //   }
  // }
  return NextResponse.json({
    ...datas,
    status,
  });
};
