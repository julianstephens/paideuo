import { Button, Container, Flex, Input, Stack } from "@chakra-ui/react";
import type { SubmitEvent } from "react";
import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Wordmark } from "../../app/AppIcon";
import { ColorModeControl } from "../../app/ColorModeControl";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { signIn } from "../../lib/api/pocketbase";
import { useSession } from "./session";

type SessionCheckProps = { retry?: () => void };

const SessionCheck = ({ retry }: SessionCheckProps) => (
  <Container as="main" maxW="md" py="12">
    <Panel align="start">
      {retry ? (
        <Stack align="start">
          <Notice role="alert">Unable to verify your session.</Notice>
          <Button onClick={retry}>Retry</Button>
        </Stack>
      ) : (
        <Notice role="status">Checking your session…</Notice>
      )}
    </Panel>
  </Container>
);

export const RequireSession = () => {
  const session = useSession();
  const { pathname, search, hash } = useLocation();

  if (session.status === "loading") return <SessionCheck />;
  if (session.status === "unavailable") return <SessionCheck retry={session.retry} />;
  if (session.status === "signed-out") {
    return <Navigate to="/sign-in" replace state={{ from: pathname + search + hash }} />;
  }
  return <Outlet />;
};

const signInDestination = (from: unknown) => {
  if (typeof from !== "string" || !/^\/(?![/\\])/.test(from)) return "/";
  const destination = URL.parse(from, window.location.origin);
  if (
    !destination ||
    destination.origin !== window.location.origin ||
    destination.pathname.startsWith("//") ||
    /^\/sign-in\/*$/i.test(destination.pathname)
  ) {
    return "/";
  }
  return { pathname: destination.pathname, search: destination.search, hash: destination.hash };
};

export const SignInPage = () => {
  const session = useSession();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await signIn(email.trim(), password);
    } catch {
      setError("Unable to sign in. Check your credentials and connection.");
    } finally {
      setPending(false);
    }
  };

  if (session.status === "loading") return <SessionCheck />;
  if (session.status === "unavailable") return <SessionCheck retry={session.retry} />;
  if (session.status === "signed-in") {
    return <Navigate to={signInDestination(location.state?.from)} replace />;
  }

  return (
    <main className="sign-in">
      <Container maxW="md" px="0">
        <Stack gap="5">
          <Flex justify="space-between" align="center" wrap="wrap" gap="4">
            <Wordmark />
            <ColorModeControl />
          </Flex>
          <Panel>
            <PageHeader title="Sign in" />
            <form onSubmit={(event) => void submit(event)}>
              <Stack gap="4">
                <FormField>
                  Email
                  <Input
                    type="email"
                    autoComplete="username"
                    value={email}
                    required
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </FormField>
                <FormField>
                  Password
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    required
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </FormField>
                {error && <Notice role="alert">{error}</Notice>}
                <Button type="submit" loading={pending}>
                  Sign in
                </Button>
              </Stack>
            </form>
          </Panel>
        </Stack>
      </Container>
    </main>
  );
};
