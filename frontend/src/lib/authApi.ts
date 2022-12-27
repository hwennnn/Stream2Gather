import BaseApi from './baseApi';

const apiVersion: string = 'v1';

class AuthApi extends BaseApi {
  async isAuth(cookies: any): Promise<boolean> {
    const qid: string | undefined = cookies.qid;
    if (qid === undefined) {
      return false;
    }

    return await this.get<boolean>(`api/${apiVersion}/auth/isAuth`, {
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        cookie: `qid=${qid}`
      }
    });
  }
}

export default new AuthApi();
