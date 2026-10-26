declare module '*/gdbf-des.cjs' {
  const gdbfDes: {
    encode(data: string, secretKey: string): string
    decode(data: string, secretKey: string): string
  }
  export = gdbfDes
}
