import 'chai';
import 'chai-spies';

declare module 'chai' {
  export const spy: ChaiSpies.Spy;
}
